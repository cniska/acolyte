import { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig, type PermissionMode } from "./app-config";

export interface ClientOptions {
  apiUrl?: string;
  apiKey?: string;
  replyTimeoutMs?: number;
}

export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text-delta"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    type: z.literal("tool-output"),
    toolCallId: z.string(),
    toolName: z.string(),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    toolName: z.string(),
    isError: z.boolean().optional(),
  }),
  z.object({ type: z.literal("status"), message: z.string() }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;

export interface Client {
  reply(input: ChatRequest, options?: { signal?: AbortSignal }): Promise<ChatResponse>;
  replyStream(
    input: ChatRequest,
    options: {
      onEvent: (event: StreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ChatResponse>;
  status(): Promise<string>;
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
  return `Cannot reach server at ${apiUrl}. Start it with: bun run dev (or bun run serve:env)`;
}

class HttpClient implements Client {
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
        throw new Error(`Remote server reply timed out after ${this.replyTimeoutMs}ms`);
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
      throw new Error(`Remote server error (${response.status}): ${errorMessage}${errorSuffix}`);
    }

    const json = (await response.json()) as Partial<ChatResponse>;
    if (typeof json.output !== "string") {
      throw new Error("Remote server returned invalid payload: missing output");
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

  async replyStream(
    input: ChatRequest,
    options: {
      onEvent: (event: StreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ChatResponse> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let timedOut = false;
    let signal = options.signal;

    if (typeof this.replyTimeoutMs === "number") {
      const timeoutController = new AbortController();
      signal = timeoutController.signal;
      onAbort = () => timeoutController.abort(options.signal?.reason);
      if (options.signal) {
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
      response = await this.fetchOrThrow("/v1/chat/stream", {
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
        throw new Error(`Remote server reply timed out after ${this.replyTimeoutMs}ms`);
      }
      throw error;
    } finally {
      if (typeof timeoutId !== "undefined") {
        clearTimeout(timeoutId);
      }
      if (options.signal && onAbort) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Remote server stream failed (${response.status}): ${body || "no body"}`);
    }
    if (!response.body) {
      throw new Error("Remote server stream returned no body");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let finalReply: ChatResponse | null = null;

    const processBlock = (block: string): void => {
      const lines = block
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      if (dataLines.length === 0) {
        return;
      }
      const jsonText = dataLines.map((line) => line.slice(5).trimStart()).join("\n");
      if (!jsonText) {
        return;
      }
      let payload: { type?: unknown; reply?: unknown; error?: unknown };
      try {
        payload = JSON.parse(jsonText);
      } catch {
        return;
      }
      if (payload.type === "done") {
        const reply = parseChatResponse(payload.reply, input.model);
        if (!reply) {
          throw new Error("Remote server stream returned invalid done payload");
        }
        finalReply = reply;
        return;
      }
      if (payload.type === "error") {
        const errorMsg = typeof payload.error === "string" ? payload.error : "Remote server stream failed";
        options.onEvent({ type: "error", error: errorMsg });
        throw new Error(errorMsg);
      }
      const event = parseStreamEvent(payload);
      if (event) {
        options.onEvent(event);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim().length > 0) {
          processBlock(buffer);
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) {
          break;
        }
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processBlock(block);
      }
    }

    if (!finalReply) {
      throw new Error("Remote server stream ended without final reply");
    }
    return finalReply;
  }

  async status(): Promise<string> {
    const response = await this.fetchOrThrow("/healthz", {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Server health check failed (${response.status}): ${body || "no body"}`);
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
    const exploreModel = asString(modelGroup?.explore);
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
      exploreModel && exploreModel !== model ? `explore_model=${exploreModel}` : undefined,
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

export function parseStreamEvent(raw: unknown): StreamEvent | null {
  const result = streamEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function parseChatResponse(payload: unknown, fallbackModel: string): ChatResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const json = payload as Partial<ChatResponse>;
  if (typeof json.output !== "string") {
    return null;
  }
  return {
    output: json.output,
    model: typeof json.model === "string" ? json.model : fallbackModel,
    modelCalls: typeof json.modelCalls === "number" ? json.modelCalls : undefined,
    toolCalls: Array.isArray((json as { toolCalls?: unknown }).toolCalls)
      ? ((json as { toolCalls?: unknown[] }).toolCalls ?? []).filter((item): item is string => typeof item === "string")
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

export function createClient(options?: ClientOptions): Client {
  const apiUrl = options?.apiUrl ?? appConfig.server.apiUrl;
  if (!apiUrl) {
    throw new Error("No API URL configured. Start the backend with: bun run dev");
  }
  const apiKey = options?.apiKey ?? appConfig.server.apiKey;
  const replyTimeoutMs = options?.replyTimeoutMs;
  return new HttpClient(apiUrl, apiKey, replyTimeoutMs);
}
