import type { ChatRequest, ChatResponse } from "./api";
import {
  type Client,
  createRemoteError,
  isConnectionFailure,
  parseRpcServerMessage,
  parseStreamEvent,
  rpcUrlFromApiUrl,
  validateFinalChatResponse,
} from "./client-contract";
import { connectionHelpMessage } from "./error-messages";
import { field } from "./field";
import { createRpcRequestId } from "./rpc-protocol";
import type { StatusFields } from "./status-contract";
import type { TaskId, TaskRecord } from "./task-contract";

type RpcServerMessage = NonNullable<ReturnType<typeof parseRpcServerMessage>>;

export class RpcClient implements Client {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey?: string,
    private readonly replyTimeoutMs?: number,
  ) {}

  private rpcUrl(): string {
    return new URL(rpcUrlFromApiUrl(this.apiUrl)).toString();
  }

  private async openSocket(): Promise<WebSocket> {
    const url = this.rpcUrl();
    const protocols = this.apiKey ? [`bearer.${this.apiKey}`] : undefined;
    return await new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url, protocols);
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

  private closeSocket(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }

  private parseSocketMessage(event: MessageEvent): RpcServerMessage | null {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return null;
    }
    return parseRpcServerMessage(raw);
  }

  private parseRawSocketData(event: MessageEvent): unknown | null {
    try {
      return JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return null;
    }
  }

  private async runUnaryRequest<T>(input: {
    request: (id: string) => unknown;
    closeError: string;
    resolve: (msg: RpcServerMessage) => T | Error;
  }): Promise<T> {
    const ws = await this.openSocket();
    const id = createRpcRequestId();
    const timeoutMs = this.replyTimeoutMs ?? 10_000;

    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        this.closeSocket(ws);
      };

      const onClose = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(input.closeError));
      };

      const onMessage = (event: MessageEvent) => {
        const raw = this.parseRawSocketData(event);
        if (!raw || typeof raw !== "object") return;
        const rawId = field(raw, "id");
        if (rawId !== id) return;
        const msg = parseRpcServerMessage(raw);
        if (!msg) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("RPC protocol mismatch for unary request. Restart the server."));
          return;
        }
        if (settled) return;
        settled = true;
        const result = input.resolve(msg);
        cleanup();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.send(JSON.stringify(input.request(id)));
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`RPC request timed out after ${timeoutMs}ms. Restart the server: acolyte restart`));
      }, timeoutMs);
    });
  }

  async status(): Promise<StatusFields> {
    return await this.runUnaryRequest<StatusFields>({
      request: (id) => ({ id, type: "status.get" }),
      closeError: "RPC connection closed before status response",
      resolve: (msg) => {
        if (msg.type === "status.result") {
          const fields: StatusFields = {};
          for (const [key, value] of Object.entries(msg.status)) {
            if (key === "ok") continue;
            if (typeof value === "string" || typeof value === "number") {
              fields[key] = value;
              continue;
            }
            if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
              fields[key] = value;
            }
          }
          return fields;
        }
        if (msg.type === "error") return new Error(msg.error);
        return new Error(`Unexpected RPC response: ${msg.type}`);
      },
    });
  }

  async taskStatus(taskId: TaskId): Promise<TaskRecord | null> {
    return await this.runUnaryRequest<TaskRecord | null>({
      request: (id) => ({ id, type: "task.status", payload: { taskId } }),
      closeError: "RPC connection closed before task status response",
      resolve: (msg) => {
        if (msg.type === "task.status.result") return msg.task;
        if (msg.type === "error") return new Error(msg.error);
        return new Error(`Unexpected RPC response: ${msg.type}`);
      },
    });
  }

  async replyStream(
    input: ChatRequest,
    options: {
      onEvent: (event: import("./client-contract").StreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ChatResponse> {
    const ws = await this.openSocket();
    const id = createRpcRequestId();
    let acceptedTaskId: TaskId | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = this.replyTimeoutMs;
    const RPC_ABORT_CLOSE_GRACE_MS = 120;

    const resetTimeout = (): void => {
      if (typeof timeoutMs !== "number") return;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        this.closeSocket(ws);
      }, timeoutMs);
    };

    resetTimeout();

    return await new Promise<ChatResponse>((resolve, reject) => {
      const cleanup = () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        ws.removeEventListener("error", onError);
        if (options.signal) options.signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        try {
          ws.send(
            JSON.stringify({
              id: createRpcRequestId(),
              type: "chat.abort",
              payload: { requestId: id },
            }),
          );
        } catch {
          // Best effort only.
        }
        cleanup();
        setTimeout(() => {
          this.closeSocket(ws);
        }, RPC_ABORT_CLOSE_GRACE_MS);
        const abortError = new Error("Request aborted");
        abortError.name = "AbortError";
        reject(abortError);
      };
      const onClose = () => {
        cleanup();
        reject(createRemoteError("RPC stream closed before final reply", { taskId: acceptedTaskId }));
      };
      const onError = () => {
        cleanup();
        reject(createRemoteError("RPC WebSocket error", { taskId: acceptedTaskId }));
      };
      const onMessage = (event: MessageEvent) => {
        resetTimeout();
        const msg = this.parseSocketMessage(event);
        if (!msg || msg.id !== id) return;
        if (msg.type === "chat.accepted") {
          acceptedTaskId = msg.taskId;
          options.onEvent({ type: "status", state: { kind: "accepted" } });
          return;
        }
        if (msg.type === "chat.queued") {
          options.onEvent({ type: "status", state: { kind: "queued", position: msg.position } });
          return;
        }
        if (msg.type === "chat.started") {
          options.onEvent({ type: "status", state: { kind: "running" } });
          return;
        }
        if (msg.type === "chat.abort.result") return;
        if (msg.type === "chat.event") {
          const parsed = parseStreamEvent(msg.event);
          if (parsed) options.onEvent(parsed);
          return;
        }
        cleanup();
        this.closeSocket(ws);
        if (msg.type === "chat.done")
          return resolve(validateFinalChatResponse(msg.reply, "RPC stream returned invalid done payload"));
        if (msg.type === "chat.error") {
          return reject(
            createRemoteError(msg.errorMessage, {
              errorId: msg.errorId,
              errorCode: msg.errorCode,
              error: msg.error,
            }),
          );
        }
        if (msg.type === "error") return reject(new Error(msg.error));
        reject(new Error(`Unexpected RPC response: ${msg.type}`));
      };

      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.addEventListener("error", onError);
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
      ws.send(JSON.stringify({ id, type: "chat.start", payload: { request: input } }));
    });
  }
}
