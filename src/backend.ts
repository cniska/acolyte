import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";

export interface BackendOptions {
  apiUrl?: string;
  apiKey?: string;
}

export interface Backend {
  reply(input: ChatRequest): Promise<ChatResponse>;
  status(): Promise<string>;
}

class LocalBackend implements Backend {
  async reply(input: ChatRequest): Promise<ChatResponse> {
    const trimmed = input.message.trim();
    const lc = trimmed.toLowerCase();

    if (lc.includes("summarize") && input.history.length > 0) {
      const userMessages = input.history.filter((m) => m.role === "user").length;
      const assistantMessages = input.history.filter((m) => m.role === "assistant").length;
      return {
        model: input.model,
        output: `Session so far: ${userMessages} user messages, ${assistantMessages} assistant messages. Ask me to /history for full local transcript.`,
      };
    }

    return {
      model: input.model,
      output: [
        "Local backend is active.",
        "Set ACOLYTE_API_URL to route CLI requests to your hosted Mastra backend.",
        "I can still track your session context, memory notes, and command history locally.",
        `You said: ${trimmed}`,
      ].join(" "),
    };
  }

  async status(): Promise<string> {
    return "mode=local-mock backend=embedded";
  }
}

class RemoteBackend implements Backend {
  constructor(private readonly apiUrl: string, private readonly apiKey?: string) {}

  async reply(input: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}/v1/chat`, {
      method: "POST",
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
    };
  }

  async status(): Promise<string> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}/healthz`, {
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
    };
    const provider =
      typeof json.provider === "string"
        ? json.provider
        : typeof json.mode === "string"
          ? json.mode
          : "unknown";
    const model = typeof json.model === "string" ? json.model : undefined;
    const service = typeof json.service === "string" ? json.service : "unknown";
    const memoryStorage =
      typeof json.memory?.storage === "string" ? json.memory.storage : undefined;
    const om = json.memory?.observational;
    const omEnabled = typeof om?.enabled === "boolean" ? om.enabled : undefined;
    const omScope = typeof om?.scope === "string" ? om.scope : undefined;
    const omModel = typeof om?.model === "string" ? om.model : undefined;
    const omObservationTokens =
      typeof om?.observationTokens === "number" ? om.observationTokens : undefined;
    const omReflectionTokens =
      typeof om?.reflectionTokens === "number" ? om.reflectionTokens : undefined;
    const omExists = typeof om?.current?.exists === "boolean" ? om.current.exists : undefined;
    const omGeneration =
      typeof om?.current?.generationCount === "number" ? om.current.generationCount : undefined;
    const omLastObservedAt =
      typeof om?.current?.lastObservedAt === "string" ? om.current.lastObservedAt : undefined;
    const omLastReflectionAt =
      typeof om?.current?.lastReflectionAt === "string" ? om.current.lastReflectionAt : undefined;
    const fields = [
      `provider=${provider}`,
      model ? `model=${model}` : undefined,
      `service=${service}`,
      `url=${this.apiUrl}`,
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
    ].filter((field): field is string => Boolean(field));
    return fields.join(" ");
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
