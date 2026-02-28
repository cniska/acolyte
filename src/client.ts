import { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import type { PermissionMode, TransportMode } from "./config-modes";
import { rpcServerMessageSchema } from "./rpc-protocol";
import { createId } from "./short-id";
import { streamErrorDetailSchema } from "./stream-error";

export interface ClientOptions {
  apiUrl?: string;
  apiKey?: string;
  replyTimeoutMs?: number;
  transport?: ClientTransport;
  transportMode?: TransportMode;
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
  return `Cannot reach server at ${apiUrl}. Start it with: acolyte serve`;
}

export function rpcUrlFromApiUrl(apiUrl: string): string {
  const source = new URL(apiUrl);
  const protocol = source.protocol === "https:" ? "wss:" : source.protocol === "http:" ? "ws:" : source.protocol;
  const basePath = source.pathname.replace(/\/$/, "");
  const path = basePath.endsWith("/v1/rpc") ? basePath : `${basePath}/v1/rpc`;
  source.protocol = protocol;
  source.pathname = path;
  source.search = "";
  source.hash = "";
  return source.toString();
}

function resolveTransportMode(apiUrl: string | undefined, explicit?: TransportMode): "http" | "rpc" {
  if (explicit === "http" || explicit === "rpc") return explicit;
  if (!apiUrl) return "http";
  if (apiUrl.startsWith("ws://") || apiUrl.startsWith("wss://")) return "rpc";
  return "http";
}

export type ClientTransport = {
  apiUrl: string;
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

class HttpTransport implements ClientTransport {
  constructor(public readonly apiUrl: string) {}

  async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.apiUrl.replace(/\/$/, "")}${path}`;
    return fetch(url, init);
  }
}

export function createHttpTransport(apiUrl: string): ClientTransport {
  return new HttpTransport(apiUrl);
}

class HttpClient implements Client {
  constructor(
    private readonly transport: ClientTransport,
    private readonly apiKey?: string,
    private readonly replyTimeoutMs?: number,
  ) {}

  private async fetchOrThrow(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.transport.request(path, init);
    } catch (error) {
      if (isConnectionFailure(error)) throw new Error(connectionHelpMessage(this.transport.apiUrl));
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
      if (timedOut) throw new Error(`Remote server stream timed out after ${timeoutMs}ms`);
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

function parseRpcServerMessage(raw: unknown): z.infer<typeof rpcServerMessageSchema> | null {
  const parsed = rpcServerMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

class RpcClient implements Client {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey?: string,
    private readonly replyTimeoutMs?: number,
  ) {}

  private rpcUrl(): string {
    const url = new URL(rpcUrlFromApiUrl(this.apiUrl));
    if (this.apiKey) url.searchParams.set("apiKey", this.apiKey);
    return url.toString();
  }

  private async openSocket(): Promise<WebSocket> {
    const url = this.rpcUrl();
    return await new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        if (isConnectionFailure(error)) reject(new Error(connectionHelpMessage(this.apiUrl)));
        else reject(error);
        return;
      }
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(socket);
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(connectionHelpMessage(this.apiUrl)));
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });
  }

  async status(): Promise<Record<string, string>> {
    const ws = await this.openSocket();
    const id = `rpc_${createId()}`;
    return await new Promise<Record<string, string>>((resolve, reject) => {
      const cleanup = () => {
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
      const onClose = () => {
        cleanup();
        reject(new Error("RPC connection closed before status response"));
      };
      const onMessage = (event: MessageEvent) => {
        let raw: unknown;
        try {
          raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch {
          return;
        }
        const msg = parseRpcServerMessage(raw);
        if (!msg || msg.id !== id) return;
        cleanup();
        if (msg.type === "status.result") {
          const fields: Record<string, string> = {};
          for (const [key, value] of Object.entries(msg.status)) {
            if (key !== "ok" && typeof value === "string") fields[key] = value;
          }
          resolve(fields);
        } else if (msg.type === "error") reject(new Error(msg.error));
        else reject(new Error(`Unexpected RPC response: ${msg.type}`));
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.send(JSON.stringify({ id, type: "status.get" }));
    });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    const ws = await this.openSocket();
    const id = `rpc_${createId()}`;
    return await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
      const onClose = () => {
        cleanup();
        reject(new Error("RPC connection closed before permission response"));
      };
      const onMessage = (event: MessageEvent) => {
        let raw: unknown;
        try {
          raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch {
          return;
        }
        const msg = parseRpcServerMessage(raw);
        if (!msg || msg.id !== id) return;
        cleanup();
        if (msg.type === "permissions.result") resolve();
        else if (msg.type === "error") reject(new Error(msg.error));
        else reject(new Error(`Unexpected RPC response: ${msg.type}`));
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.send(JSON.stringify({ id, type: "permissions.set", payload: { mode } }));
    });
  }

  async replyStream(
    input: ChatRequest,
    options: {
      onEvent: (event: StreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ChatResponse> {
    const ws = await this.openSocket();
    const id = `rpc_${createId()}`;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = this.replyTimeoutMs;

    const resetTimeout = (): void => {
      if (typeof timeoutMs !== "number") return;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }, timeoutMs);
    };

    resetTimeout();

    return await new Promise<ChatResponse>((resolve, reject) => {
      const cleanup = () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        if (options.signal) options.signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        try {
          ws.send(
            JSON.stringify({
              id: `rpc_abort_${createId()}`,
              type: "chat.abort",
              payload: { requestId: id },
            }),
          );
        } catch {
          // Best effort only.
        }
        cleanup();
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error("Request aborted"));
      };
      const onClose = () => {
        cleanup();
        reject(new Error("RPC stream closed before final reply"));
      };
      const onMessage = (event: MessageEvent) => {
        resetTimeout();
        let raw: unknown;
        try {
          raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch {
          return;
        }
        const msg = parseRpcServerMessage(raw);
        if (!msg || msg.id !== id) return;
        if (msg.type === "chat.accepted") return;
        if (msg.type === "chat.queued") return;
        if (msg.type === "chat.started") return;
        if (msg.type === "chat.abort.result") return;
        if (msg.type === "chat.event") {
          const parsed = parseStreamEvent(msg.event);
          if (parsed) options.onEvent(parsed);
          return;
        }
        cleanup();
        try {
          ws.close();
        } catch {
          // ignore
        }
        if (msg.type === "chat.done") {
          const reply = parseChatResponse(msg.reply, input.model);
          if (!reply) return reject(new Error("RPC stream returned invalid done payload"));
          return resolve(reply);
        }
        if (msg.type === "chat.error") {
          options.onEvent({
            type: "error",
            error: msg.error,
            errorCode: msg.errorCode,
            errorDetail: msg.errorDetail,
          });
          return reject(createRemoteError(msg.error, { errorCode: msg.errorCode, errorDetail: msg.errorDetail }));
        }
        if (msg.type === "error") return reject(new Error(msg.error));
        reject(new Error(`Unexpected RPC response: ${msg.type}`));
      };

      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      if (options.signal) options.signal.addEventListener("abort", onAbort, { once: true });
      ws.send(JSON.stringify({ id, type: "chat.start", payload: { request: input } }));
    });
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
  const apiKey = options?.apiKey ?? appConfig.server.apiKey;
  const replyTimeoutMs = options?.replyTimeoutMs;
  const mode = resolveTransportMode(apiUrl, options?.transportMode ?? appConfig.server.transportMode);

  if (mode === "rpc") {
    if (!apiUrl) throw new Error("No API URL configured. Start the server with: acolyte serve");
    return new RpcClient(apiUrl, apiKey, replyTimeoutMs);
  }

  const transport = options?.transport ?? (apiUrl ? createHttpTransport(apiUrl) : null);
  if (!transport) throw new Error("No API URL configured. Start the server with: acolyte serve");
  return new HttpClient(transport, apiKey, replyTimeoutMs);
}
