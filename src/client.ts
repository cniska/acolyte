import { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig, type PermissionMode } from "./app-config";
import { streamErrorDetailSchema } from "./stream-error";

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
    errorCode: z.string().optional(),
    errorDetail: streamErrorDetailSchema.optional(),
  }),
  z.object({ type: z.literal("status"), message: z.string() }),
  z.object({
    type: z.literal("error"),
    error: z.string(),
    errorCode: z.string().optional(),
    errorDetail: streamErrorDetailSchema.optional(),
  }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;
export interface Client {
  replyStream(
    input: ChatRequest,
    options: {
      onEvent: (event: StreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ChatResponse>;
  status(): Promise<Record<string, string>>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
}

type RemoteErrorMetadata = {
  status?: number;
  errorId?: string;
  errorCode?: string;
  errorDetail?: z.infer<typeof streamErrorDetailSchema>;
};

function createRemoteError(message: string, metadata: RemoteErrorMetadata = {}): Error {
  return Object.assign(new Error(message), metadata);
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
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
      if (isConnectionFailure(error)) throw new Error(connectionHelpMessage(this.apiUrl));
      throw error;
    }
  }

  async replyStream(
    input: ChatRequest,
    options: {
      onEvent: (event: StreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ChatResponse> {
    const timeoutMs = this.replyTimeoutMs;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let timedOut = false;
    let signal = options.signal;
    let timeoutController: AbortController | undefined;

    if (typeof timeoutMs === "number") {
      timeoutController = new AbortController();
      signal = timeoutController.signal;
      onAbort = () => timeoutController?.abort(options.signal?.reason);
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    }

    let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    const resetTimeout = (): void => {
      if (typeof timeoutMs !== "number" || !timeoutController) return;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timedOut = false;
      timeoutId = setTimeout(() => {
        timedOut = true;
        timeoutController?.abort();
        streamReader?.cancel().catch(() => {});
      }, timeoutMs);
    };

    const cleanup = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (options.signal && onAbort) options.signal.removeEventListener("abort", onAbort);
    };

    resetTimeout();

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
      cleanup();
      if (timedOut) throw new Error(`Remote server reply timed out after ${timeoutMs}ms`);
      throw error;
    }

    if (!response.ok) {
      cleanup();
      const body = await response.text();
      let errorMessage = body || "no body";
      let errorId: string | undefined;
      let errorCode: string | undefined;
      let errorDetail: z.infer<typeof streamErrorDetailSchema> | undefined;
      try {
        const parsed = JSON.parse(body) as {
          error?: unknown;
          errorId?: unknown;
          errorCode?: unknown;
          errorDetail?: unknown;
        };
        if (typeof parsed.error === "string" && parsed.error.length > 0) errorMessage = parsed.error;
        if (typeof parsed.errorId === "string" && parsed.errorId.length > 0) errorId = parsed.errorId;
        if (typeof parsed.errorCode === "string" && parsed.errorCode.length > 0) errorCode = parsed.errorCode;
        const parsedDetail = streamErrorDetailSchema.safeParse(parsed.errorDetail);
        if (parsedDetail.success) errorDetail = parsedDetail.data;
      } catch {
        // Non-JSON error body; keep raw body text.
      }
      const errorSuffix = errorId ? ` [error_id=${errorId}]` : "";
      throw createRemoteError(`Remote server stream failed (${response.status}): ${errorMessage}${errorSuffix}`, {
        status: response.status,
        errorId,
        errorCode,
        errorDetail,
      });
    }
    if (!response.body) {
      cleanup();
      throw new Error("Remote server stream returned no body");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    streamReader = reader;
    let buffer = "";
    let finalReply: ChatResponse | null = null;

    const processBlock = (block: string): void => {
      const lines = block
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      if (dataLines.length === 0) return;
      const jsonText = dataLines.map((line) => line.slice(5).trimStart()).join("\n");
      if (!jsonText) return;
      let payload: { type?: unknown; reply?: unknown; error?: unknown };
      try {
        payload = JSON.parse(jsonText);
      } catch {
        return;
      }
      if (payload.type === "done") {
        const reply = parseChatResponse(payload.reply, input.model);
        if (!reply) throw new Error("Remote server stream returned invalid done payload");
        finalReply = reply;
        return;
      }
      if (payload.type === "error") {
        const parsedErrorEvent = parseStreamEvent(payload);
        const errorMsg =
          parsedErrorEvent?.type === "error"
            ? parsedErrorEvent.error
            : typeof payload.error === "string"
              ? payload.error
              : "Remote server stream failed";
        if (parsedErrorEvent?.type === "error") options.onEvent(parsedErrorEvent);
        else options.onEvent({ type: "error", error: errorMsg });
        throw createRemoteError(errorMsg, {
          errorCode: parsedErrorEvent?.type === "error" ? parsedErrorEvent.errorCode : undefined,
          errorDetail: parsedErrorEvent?.type === "error" ? parsedErrorEvent.errorDetail : undefined,
        });
      }
      const event = parseStreamEvent(payload);
      if (event) options.onEvent(event);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim().length > 0) processBlock(buffer);
          break;
        }
        resetTimeout();
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary === -1) break;
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          processBlock(block);
        }
      }
    } catch (error) {
      cleanup();
      if (timedOut) throw new Error(`Remote server stream timed out after ${timeoutMs}ms of inactivity`);
      throw error;
    }

    cleanup();

    if (timedOut && !finalReply) throw new Error(`Remote server stream timed out after ${timeoutMs}ms of inactivity`);
    if (!finalReply) throw new Error("Remote server stream ended without final reply");
    return finalReply;
  }

  async status(): Promise<Record<string, string>> {
    const response = await this.fetchOrThrow("/v1/status", {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Status check failed (${response.status}): ${body || "no body"}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key !== "ok" && typeof value === "string") fields[key] = value;
    }
    return fields;
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
  if (!payload || typeof payload !== "object") return null;
  const json = payload as Partial<ChatResponse>;
  if (typeof json.output !== "string") return null;
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
  if (!apiUrl) throw new Error("No API URL configured. Start the server with: bun run dev");
  const apiKey = options?.apiKey ?? appConfig.server.apiKey;
  const replyTimeoutMs = options?.replyTimeoutMs;
  return new HttpClient(apiUrl, apiKey, replyTimeoutMs);
}
