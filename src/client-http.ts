import type { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { invariant } from "./assert";
import {
  type Client,
  type ClientTransport,
  createRemoteError,
  isConnectionFailure,
  parseChatResponse,
  parseStreamEvent,
} from "./client-contract";
import type { PermissionMode } from "./config-contract";
import { connectionHelpMessage } from "./error-messages";
import type { StatusFields } from "./status-contract";
import { streamErrorDetailSchema } from "./stream-error";
import type { TaskRecord } from "./task-state";

const NUMERIC_STATUS_KEYS = new Set(["tasks_total", "tasks_running", "tasks_detached", "rpc_queue_length"]);

type ParsedHttpError = {
  errorMessage: string;
  errorId?: string;
  errorCode?: string;
  errorDetail?: z.infer<typeof streamErrorDetailSchema>;
};

function parseHttpErrorBody(body: string): ParsedHttpError {
  const parsedError: ParsedHttpError = { errorMessage: body || "no body" };
  try {
    const parsed = JSON.parse(body) as {
      error?: unknown;
      errorId?: unknown;
      errorCode?: unknown;
      errorDetail?: unknown;
    };
    if (typeof parsed.error === "string" && parsed.error.length > 0) parsedError.errorMessage = parsed.error;
    if (typeof parsed.errorId === "string" && parsed.errorId.length > 0) parsedError.errorId = parsed.errorId;
    if (typeof parsed.errorCode === "string" && parsed.errorCode.length > 0) parsedError.errorCode = parsed.errorCode;
    const parsedDetail = streamErrorDetailSchema.safeParse(parsed.errorDetail);
    if (parsedDetail.success) parsedError.errorDetail = parsedDetail.data;
  } catch {
    // Non-JSON error body; keep raw body text.
  }
  return parsedError;
}

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

export class HttpClient implements Client {
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
      onEvent: (event: import("./client-contract").StreamEvent) => void;
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
      const { errorMessage, errorId, errorCode, errorDetail } = parseHttpErrorBody(body);
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
        finalReply = parseChatResponse(payload.reply);
        if (!finalReply) throw new Error("Remote server stream returned invalid done payload");
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
    invariant(finalReply, "Remote server stream ended without final reply");
    return finalReply;
  }

  async status(): Promise<StatusFields> {
    const response = await this.fetchOrThrow("/v1/status", {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Status check failed (${response.status}): ${body || "no body"}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const fields: StatusFields = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "ok") continue;
      if (typeof value === "string") {
        fields[key] = value;
        continue;
      }
      if (typeof value === "number" && NUMERIC_STATUS_KEYS.has(key)) fields[key] = value;
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

  async taskStatus(taskId: string): Promise<TaskRecord | null> {
    void taskId;
    throw new Error("task.status is only supported over RPC transport");
  }
}
