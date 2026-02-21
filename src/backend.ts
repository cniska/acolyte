import type { ChatRequest, ChatResponse } from "./api";
import { appConfig, type PermissionMode, setPermissionMode } from "./app-config";

export interface BackendOptions {
  apiUrl?: string;
  apiKey?: string;
}

export interface Backend {
  reply(input: ChatRequest, options?: { signal?: AbortSignal }): Promise<ChatResponse>;
  status(): Promise<string>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("unable to connect") || message.includes("connection refused") || message.includes("econnrefused")
  );
}

function connectionHelpMessage(apiUrl: string): string {
  return `Cannot reach backend at ${apiUrl}. Start it with: bun run dev (or bun run serve:env)`;
}

class LocalBackend implements Backend {
  async reply(input: ChatRequest, _options?: { signal?: AbortSignal }): Promise<ChatResponse> {
    const trimmed = input.message.trim();
    const lc = trimmed.toLowerCase();

    if (lc.includes("summarize") && input.history.length > 0) {
      const userMessages = input.history.filter((m) => m.role === "user").length;
      const assistantMessages = input.history.filter((m) => m.role === "assistant").length;
      return {
        model: input.model,
        output: `Session so far: ${userMessages} user messages, ${assistantMessages} assistant messages. Ask me to /history for full local transcript.`,
        usage: {
          promptTokens: Math.ceil(
            (input.message.length + input.history.map((m) => m.content.length).join("").length) / 4,
          ),
          completionTokens: 32,
          totalTokens:
            Math.ceil((input.message.length + input.history.map((m) => m.content.length).join("").length) / 4) + 32,
        },
      };
    }

    const output = [
      "Local backend is active.",
      "Set ACOLYTE_API_URL to route CLI requests to your hosted Mastra backend.",
      "I can still track your session context, memory notes, and command history locally.",
      `You said: ${trimmed}`,
    ].join(" ");
    const promptTokens = Math.ceil((trimmed.length + input.history.map((m) => m.content.length).join("").length) / 4);
    return {
      model: input.model,
      output,
      usage: {
        promptTokens,
        completionTokens: Math.ceil(output.length / 4),
        totalTokens: promptTokens + Math.ceil(output.length / 4),
      },
    };
  }

  async status(): Promise<string> {
    return `mode=local-mock backend=embedded permission_mode=${appConfig.agent.permissions.mode}`;
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    setPermissionMode(mode);
  }
}

class RemoteBackend implements Backend {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey?: string,
  ) {}

  private async fetchOrThrow(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.apiUrl.replace(/\/$/, "")}${path}`;
    try {
      return await fetch(url, init);
    } catch (error) {
      if (isConnectionFailure(error)) {
        throw new Error(connectionHelpMessage(this.apiUrl));
      }
      throw error;
    }
  }

  async reply(input: ChatRequest, options?: { signal?: AbortSignal }): Promise<ChatResponse> {
    const response = await this.fetchOrThrow("/v1/chat", {
      method: "POST",
      signal: options?.signal,
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Remote backend error (${response.status}): ${body || "no body"}`);
    }

    const json = (await response.json()) as Partial<ChatResponse>;
    if (typeof json.output !== "string") {
      throw new Error("Remote backend returned invalid payload: missing output");
    }

    return {
      output: json.output,
      model: typeof json.model === "string" ? json.model : input.model,
      usage:
        json.usage &&
        typeof json.usage === "object" &&
        typeof (json.usage as { promptTokens?: unknown }).promptTokens === "number" &&
        typeof (json.usage as { completionTokens?: unknown }).completionTokens === "number" &&
        typeof (json.usage as { totalTokens?: unknown }).totalTokens === "number"
          ? {
              promptTokens: (json.usage as { promptTokens: number }).promptTokens,
              completionTokens: (json.usage as { completionTokens: number }).completionTokens,
              totalTokens: (json.usage as { totalTokens: number }).totalTokens,
              promptBudgetTokens:
                typeof (json.usage as { promptBudgetTokens?: unknown }).promptBudgetTokens === "number"
                  ? (json.usage as { promptBudgetTokens: number }).promptBudgetTokens
                  : undefined,
              promptTruncated:
                typeof (json.usage as { promptTruncated?: unknown }).promptTruncated === "boolean"
                  ? (json.usage as { promptTruncated: boolean }).promptTruncated
                  : undefined,
            }
          : undefined,
      budgetWarning: typeof json.budgetWarning === "string" ? json.budgetWarning : undefined,
    };
  }

  async status(): Promise<string> {
    const response = await this.fetchOrThrow("/healthz", {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Backend health check failed (${response.status}): ${body || "no body"}`);
    }

    const json = (await response.json()) as {
      provider?: unknown;
      mode?: unknown;
      model?: unknown;
      models?: {
        main?: unknown;
        planner?: unknown;
        coder?: unknown;
        reviewer?: unknown;
      };
      service?: unknown;
      memory?: {
        storage?: unknown;
        observational?: {
          enabled?: unknown;
          scope?: unknown;
          model?: unknown;
          observationTokens?: unknown;
          reflectionTokens?: unknown;
          current?: {
            exists?: unknown;
            generationCount?: unknown;
            lastObservedAt?: unknown;
            lastReflectionAt?: unknown;
          };
          currentError?: unknown;
        };
      };
      permissionMode?: unknown;
      apiBaseUrl?: unknown;
    };
    const provider =
      typeof json.provider === "string" ? json.provider : typeof json.mode === "string" ? json.mode : "unknown";
    const model = typeof json.model === "string" ? json.model : undefined;
    const modelMain = typeof json.models?.main === "string" ? json.models.main : undefined;
    const modelPlanner = typeof json.models?.planner === "string" ? json.models.planner : undefined;
    const modelCoder = typeof json.models?.coder === "string" ? json.models.coder : undefined;
    const modelReviewer = typeof json.models?.reviewer === "string" ? json.models.reviewer : undefined;
    const service = typeof json.service === "string" ? json.service : "unknown";
    const apiBaseUrl = typeof json.apiBaseUrl === "string" ? json.apiBaseUrl : undefined;
    const memoryStorage = typeof json.memory?.storage === "string" ? json.memory.storage : undefined;
    const om = json.memory?.observational;
    const omEnabled = typeof om?.enabled === "boolean" ? om.enabled : undefined;
    const omScope = typeof om?.scope === "string" ? om.scope : undefined;
    const omModel = typeof om?.model === "string" ? om.model : undefined;
    const omObservationTokens = typeof om?.observationTokens === "number" ? om.observationTokens : undefined;
    const omReflectionTokens = typeof om?.reflectionTokens === "number" ? om.reflectionTokens : undefined;
    const omExists = typeof om?.current?.exists === "boolean" ? om.current.exists : undefined;
    const omGeneration = typeof om?.current?.generationCount === "number" ? om.current.generationCount : undefined;
    const omLastObservedAt = typeof om?.current?.lastObservedAt === "string" ? om.current.lastObservedAt : undefined;
    const omLastReflectionAt =
      typeof om?.current?.lastReflectionAt === "string" ? om.current.lastReflectionAt : undefined;
    const fields = [
      `provider=${provider}`,
      model ? `model=${model}` : undefined,
      modelMain ? `model_main=${modelMain}` : undefined,
      modelPlanner ? `model_planner=${modelPlanner}` : undefined,
      modelCoder ? `model_coder=${modelCoder}` : undefined,
      modelReviewer ? `model_reviewer=${modelReviewer}` : undefined,
      `service=${service}`,
      `url=${this.apiUrl}`,
      apiBaseUrl ? `api_base_url=${apiBaseUrl}` : undefined,
      memoryStorage ? `memory_storage=${memoryStorage}` : undefined,
      omEnabled === undefined ? undefined : `om=${omEnabled ? "enabled" : "disabled"}`,
      omScope ? `om_scope=${omScope}` : undefined,
      omModel ? `om_model=${omModel}` : undefined,
      omObservationTokens === undefined ? undefined : `om_obs_tokens=${omObservationTokens}`,
      omReflectionTokens === undefined ? undefined : `om_ref_tokens=${omReflectionTokens}`,
      omExists === undefined ? undefined : `om_exists=${omExists}`,
      omGeneration === undefined ? undefined : `om_gen=${omGeneration}`,
      omLastObservedAt ? `om_last_observed=${omLastObservedAt}` : undefined,
      omLastReflectionAt ? `om_last_reflection=${omLastReflectionAt}` : undefined,
      typeof json.permissionMode === "string" ? `permission_mode=${json.permissionMode}` : undefined,
    ].filter((field): field is string => Boolean(field));
    return fields.join(" ");
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    const response = await this.fetchOrThrow("/v1/permissions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ mode }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to set permission mode (${response.status}): ${body || "no body"}`);
    }
  }
}

export function createBackend(options?: BackendOptions): Backend {
  const apiUrl = options?.apiUrl ?? appConfig.server.apiUrl;
  const apiKey = options?.apiKey ?? appConfig.server.apiKey;

  if (!apiUrl) {
    return new LocalBackend();
  }

  return new RemoteBackend(apiUrl, apiKey);
}
