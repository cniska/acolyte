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
import type { PermissionMode } from "./config-contract";
import { connectionHelpMessage } from "./error-messages";
import { createId } from "./short-id";
import type { StatusFields } from "./status-contract";
import type { TaskRecord } from "./task-contract";

type RpcServerMessage = NonNullable<ReturnType<typeof parseRpcServerMessage>>;

export class RpcClient implements Client {
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

  private async runUnaryRequest<T>(input: {
    request: (id: string) => unknown;
    closeError: string;
    resolve: (msg: RpcServerMessage) => T | Error;
  }): Promise<T> {
    const ws = await this.openSocket();
    const id = `rpc_${createId()}`;

    return await new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        this.closeSocket(ws);
      };

      const onClose = () => {
        cleanup();
        reject(new Error(input.closeError));
      };

      const onMessage = (event: MessageEvent) => {
        const msg = this.parseSocketMessage(event);
        if (!msg || msg.id !== id) return;
        const result = input.resolve(msg);
        cleanup();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.send(JSON.stringify(input.request(id)));
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
            if (key !== "ok" && (typeof value === "string" || typeof value === "number")) fields[key] = value;
          }
          return fields;
        }
        if (msg.type === "error") return new Error(msg.error);
        return new Error(`Unexpected RPC response: ${msg.type}`);
      },
    });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.runUnaryRequest<void>({
      request: (id) => ({ id, type: "permissions.set", payload: { mode } }),
      closeError: "RPC connection closed before permission response",
      resolve: (msg) => {
        if (msg.type === "permissions.result") return;
        if (msg.type === "error") return new Error(msg.error);
        return new Error(`Unexpected RPC response: ${msg.type}`);
      },
    });
  }

  async taskStatus(taskId: string): Promise<TaskRecord | null> {
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
    const id = `rpc_${createId()}`;
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
        setTimeout(() => {
          this.closeSocket(ws);
        }, RPC_ABORT_CLOSE_GRACE_MS);
        const abortError = new Error("Request aborted");
        abortError.name = "AbortError";
        reject(abortError);
      };
      const onClose = () => {
        cleanup();
        reject(createRemoteError("RPC stream closed before final reply", { taskId: id }));
      };
      const onMessage = (event: MessageEvent) => {
        resetTimeout();
        const msg = this.parseSocketMessage(event);
        if (!msg || msg.id !== id) return;
        if (msg.type === "chat.accepted") {
          options.onEvent({ type: "status", message: "Accepted by server…" });
          return;
        }
        if (msg.type === "chat.queued") {
          options.onEvent({ type: "status", message: `Queued (position ${msg.position})…` });
          return;
        }
        if (msg.type === "chat.started") {
          options.onEvent({ type: "status", message: "Running…" });
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
