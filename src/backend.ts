import type { ChatRequest, ChatResponse } from "./api";
import { appConfig, type PermissionMode, setPermissionMode } from "./app-config";
import { isProviderAvailable, providerFromModel } from "./provider-config";
import { getMemoryContextEntries } from "./soul";

export interface BackendOptions {
  apiUrl?: string;
  apiKey?: string;
  replyTimeoutMs?: number;
}

export type ChatProgressEvent = {
  seq: number;
  message: string;
  kind?: "status" | "tool" | "error";
  toolCallId?: string;
  toolName?: string;
  phase?: "start" | "result" | "error" | "chunk_start" | "chunk_delta" | "chunk_end";
};

export type ChatProgress = {
  sessionId: string;
  requestId: string;
  done: boolean;
  events: ChatProgressEvent[];
};

export interface Backend {
  reply(input: ChatRequest, options?: { signal?: AbortSignal }): Promise<ChatResponse>;
  status(): Promise<string>;
  progress(sessionId: string, afterSeq?: number): Promise<ChatProgress | null>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("unable to connect") ||
    message.includes("typo in the url or port") ||
    message.includes("connection refused") ||
    message.includes("econnrefused") ||
    message.includes("socket connection was closed unexpectedly") ||
    message.includes("socket closed")
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
      "Set the backend URL with `acolyte config set apiUrl <url>` to route CLI requests to your hosted Mastra backend.",
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
    const model = appConfig.model;
    const provider = providerFromModel(model);
    const providerConfig = {
      openaiApiKey: appConfig.openai.apiKey,
      openaiBaseUrl: appConfig.openai.baseUrl,
      anthropicApiKey: appConfig.anthropic.apiKey,
      googleApiKey: appConfig.google.apiKey,
    };
    const providerReady = isProviderAvailable({ provider, ...providerConfig });
    let memoryContextCount: number | undefined;
    try {
      memoryContextCount = (await getMemoryContextEntries()).length;
    } catch {
      memoryContextCount = undefined;
    }
    const fields = [
      "provider=local-mock",
      `model=${model}`,
      `provider_ready=${providerReady}`,
      "backend=embedded",
      `permission_mode=${appConfig.agent.permissions.mode}`,
      memoryContextCount === undefined ? undefined : `memory_context=${memoryContextCount}`,
    ];
    return fields.filter((field): field is string => Boolean(field)).join(" ");
  }

  async progress(_sessionId: string, _afterSeq = 0): Promise<ChatProgress | null> {
    return null;
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    setPermissionMode(mode);
  }
}

class RemoteBackend implements Backend {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey?: string,
    private readonly replyTimeoutMs?: number,
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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let timedOut = false;
    let signal = options?.signal;

    if (typeof this.replyTimeoutMs === "number") {
      const timeoutController = new AbortController();
      signal = timeoutController.signal;
      onAbort = () => timeoutController.abort(options?.signal?.reason);
      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
      timeoutId = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, this.replyTimeoutMs);
    }

    let response: Response;
    try {
      response = await this.fetchOrThrow("/v1/chat", {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(input),
      });
    } catch (error) {
      if (timedOut) {
        throw new Error(`Remote backend reply timed out after ${this.replyTimeoutMs}ms`);
      }
      throw error;
    } finally {
      if (typeof timeoutId !== "undefined") {
        clearTimeout(timeoutId);
      }
      if (options?.signal && onAbort) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }

    if (!response.ok) {
      const body = await response.text();
      let errorMessage = body || "no body";
      let errorId: string | undefined;
      try {
        const parsed = JSON.parse(body) as { error?: unknown; errorId?: unknown };
        if (typeof parsed.error === "string" && parsed.error.length > 0) {
          errorMessage = parsed.error;
        }
        if (typeof parsed.errorId === "string" && parsed.errorId.length > 0) {
          errorId = parsed.errorId;
        }
      } catch {
        // Non-JSON error body; keep raw body text.
      }
      const errorSuffix = errorId ? ` [error_id=${errorId}]` : "";
      throw new Error(`Remote backend error (${response.status}): ${errorMessage}${errorSuffix}`);
    }

    const json = (await response.json()) as Partial<ChatResponse>;
    if (typeof json.output !== "string") {
      throw new Error("Remote backend returned invalid payload: missing output");
    }

    return {
      output: json.output,
      model: typeof json.model === "string" ? json.model : input.model,
      modelCalls: typeof json.modelCalls === "number" ? json.modelCalls : undefined,
      toolCalls: Array.isArray((json as { toolCalls?: unknown }).toolCalls)
        ? ((json as { toolCalls?: unknown[] }).toolCalls ?? []).filter(
            (item): item is string => typeof item === "string",
          )
        : undefined,
      progressMessages: Array.isArray((json as { progressMessages?: unknown }).progressMessages)
        ? ((json as { progressMessages?: unknown[] }).progressMessages ?? []).filter(
            (item): item is string => typeof item === "string",
          )
        : undefined,
      progressEvents: Array.isArray((json as { progressEvents?: unknown }).progressEvents)
        ? ((json as { progressEvents?: unknown[] }).progressEvents ?? []).reduce<
            NonNullable<ChatResponse["progressEvents"]>
          >((acc, entry) => {
            if (!entry || typeof entry !== "object") {
              return acc;
            }
            const message = (entry as { message?: unknown }).message;
            if (typeof message !== "string") {
              return acc;
            }
            const kind = (entry as { kind?: unknown }).kind;
            const toolCallId = (entry as { toolCallId?: unknown }).toolCallId;
            const toolName = (entry as { toolName?: unknown }).toolName;
            const phase = (entry as { phase?: unknown }).phase;
            const normalized: NonNullable<ChatResponse["progressEvents"]>[number] = { message };
            if (kind === "status" || kind === "tool" || kind === "error") {
              normalized.kind = kind;
            }
            if (typeof toolCallId === "string") {
              normalized.toolCallId = toolCallId;
            }
            if (typeof toolName === "string") {
              normalized.toolName = toolName;
            }
            if (
              phase === "start" ||
              phase === "result" ||
              phase === "error" ||
              phase === "chunk_start" ||
              phase === "chunk_delta" ||
              phase === "chunk_end"
            ) {
              normalized.phase = phase;
            }
            acc.push(normalized);
            return acc;
          }, [])
        : undefined,
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

    const json = (await response.json()) as Record<string, unknown>;
    const asRecord = (value: unknown): Record<string, unknown> | undefined =>
      value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
    const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
    const asNumber = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
    const asBoolean = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);
    const providerGroup = asRecord(json.provider);
    const modelGroup = asRecord(json.model);
    const providerReadyGroup = asRecord(json.provider_ready);
    const serviceGroup = asRecord(json.service);
    const memoryGroup = asRecord(json.memory);
    const omGroup = asRecord(json.om);

    const provider = asString(providerGroup?.status) ?? asString(json.provider) ?? asString(json.mode) ?? "unknown";
    const model = asString(modelGroup?.status) ?? asString(json.model);
    const providerReady = asBoolean(json.provider_ready) ?? asBoolean(providerReadyGroup?.status);

    const service = asString(serviceGroup?.status) ?? asString(json.service) ?? "unknown";
    const serviceUrl = asString(serviceGroup?.url) ?? this.apiUrl;
    const apiBaseUrl = asString(providerGroup?.api_url) ?? asString(json.apiBaseUrl);

    const memoryStorage = asString(memoryGroup?.status);
    const memoryContextCount = asNumber(memoryGroup?.entries);

    const omStatus = asString(omGroup?.status);
    let omEnabled: boolean | undefined;
    if (omStatus === "enabled") {
      omEnabled = true;
    } else if (omStatus === "disabled") {
      omEnabled = false;
    } else {
      omEnabled = undefined;
    }
    let omEnabledField: string | undefined;
    if (omEnabled !== undefined) {
      const omText = omEnabled ? "enabled" : "disabled";
      omEnabledField = `om=${omText}`;
    }
    const omScope = asString(omGroup?.scope);
    const omModel = asString(omGroup?.model);
    const omTokens = asRecord(omGroup?.tokens);
    const omObservationTokens = asNumber(omTokens?.obs);
    const omReflectionTokens = asNumber(omTokens?.ref);
    const omState = asRecord(omGroup?.state);
    const omExists = asBoolean(omState?.exists);
    const omGeneration = asNumber(omState?.gen);
    const omLastObservedAt = asString(omGroup?.last_observed);
    const omLastReflectionAt = asString(omGroup?.last_reflection);
    const permissionMode = asString(json.permissions) ?? asString(json.permissionMode);
    const fields = [
      `provider=${provider}`,
      model ? `model=${model}` : undefined,
      providerReady === undefined ? undefined : `provider_ready=${providerReady}`,
      `service=${service}`,
      `url=${serviceUrl}`,
      apiBaseUrl ? `provider_api_url=${apiBaseUrl}` : undefined,
      memoryStorage ? `memory_storage=${memoryStorage}` : undefined,
      memoryContextCount === undefined ? undefined : `memory_context=${memoryContextCount}`,
      omEnabledField,
      omScope ? `om_scope=${omScope}` : undefined,
      omModel ? `om_model=${omModel}` : undefined,
      omObservationTokens === undefined ? undefined : `om_obs_tokens=${omObservationTokens}`,
      omReflectionTokens === undefined ? undefined : `om_ref_tokens=${omReflectionTokens}`,
      omExists === undefined ? undefined : `om_exists=${omExists}`,
      omGeneration === undefined ? undefined : `om_gen=${omGeneration}`,
      omLastObservedAt ? `om_last_observed=${omLastObservedAt}` : undefined,
      omLastReflectionAt ? `om_last_reflection=${omLastReflectionAt}` : undefined,
      permissionMode ? `permission_mode=${permissionMode}` : undefined,
    ].filter((field): field is string => Boolean(field));
    return fields.join(" ");
  }

  async progress(sessionId: string, afterSeq = 0): Promise<ChatProgress | null> {
    const query = new URLSearchParams({
      sessionId,
      afterSeq: String(afterSeq),
    });
    const response = await this.fetchOrThrow(`/v1/chat/progress?${query.toString()}`, {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Backend progress check failed (${response.status}): ${body || "no body"}`);
    }
    const json = (await response.json()) as {
      sessionId?: unknown;
      requestId?: unknown;
      done?: unknown;
      events?: unknown;
    };
    if (typeof json.sessionId !== "string" || typeof json.requestId !== "string") {
      return null;
    }
    const events = Array.isArray(json.events)
      ? json.events
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }
            const seq = (entry as { seq?: unknown }).seq;
            const message = (entry as { message?: unknown }).message;
            const kind = (entry as { kind?: unknown }).kind;
            const toolCallId = (entry as { toolCallId?: unknown }).toolCallId;
            const toolName = (entry as { toolName?: unknown }).toolName;
            const phase = (entry as { phase?: unknown }).phase;
            if (typeof seq !== "number" || typeof message !== "string") {
              return null;
            }
            const normalized: ChatProgressEvent = { seq, message };
            if (kind === "status" || kind === "tool" || kind === "error") {
              normalized.kind = kind;
            }
            if (typeof toolCallId === "string" && toolCallId.length > 0) {
              normalized.toolCallId = toolCallId;
            }
            if (typeof toolName === "string" && toolName.length > 0) {
              normalized.toolName = toolName;
            }
            if (
              phase === "start" ||
              phase === "result" ||
              phase === "error" ||
              phase === "chunk_start" ||
              phase === "chunk_delta" ||
              phase === "chunk_end"
            ) {
              normalized.phase = phase;
            }
            return normalized;
          })
          .filter((entry): entry is ChatProgressEvent => entry !== null)
      : [];
    return {
      sessionId: json.sessionId,
      requestId: json.requestId,
      done: typeof json.done === "boolean" ? json.done : false,
      events,
    };
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
  const replyTimeoutMs = options?.replyTimeoutMs;

  if (!apiUrl) {
    return new LocalBackend();
  }

  return new RemoteBackend(apiUrl, apiKey, replyTimeoutMs);
}
