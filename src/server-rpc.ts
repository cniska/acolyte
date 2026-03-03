import type { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig, setPermissionMode } from "./app-config";
import { log } from "./log";
import { rpcClientMessageSchema } from "./rpc-protocol";
import { createSerialPerConnectionQueuePolicy } from "./rpc-queue";
import type { RunChatHandlers, StatusPayload, StreamErrorPayload } from "./server-contract";
import type { TaskState, TaskTransitionReason } from "./task-contract";
import type { TaskRegistry } from "./task-registry";

const RPC_MAX_QUEUED_TASKS_PER_CONNECTION = 25;

export type ActiveRpcChatState = {
  aborted: boolean;
};

export type QueuedRpcChat = {
  id: string;
  request: ChatRequest;
  state: ActiveRpcChatState;
};

export type RpcConnectionState = {
  authed: boolean;
  activeChats: Map<string, ActiveRpcChatState>;
  runningChatId: string | null;
  queue: QueuedRpcChat[];
};

type ParsedRpcEnvelope = {
  id: string | null;
  message: z.infer<typeof rpcClientMessageSchema> | null;
};
type RpcClientMessage = z.infer<typeof rpcClientMessageSchema>;
type RpcHandlerMap = {
  [K in RpcClientMessage["type"]]: (msg: Extract<RpcClientMessage, { type: K }>) => Promise<void> | void;
};

type WorkerRunInput = {
  taskId: string;
  request: ChatRequest;
  state: ActiveRpcChatState;
  shouldYield: () => boolean;
  emitEvent: (event: Record<string, unknown>) => void;
  emitDone: (reply: ChatResponse) => void;
  emitError: (payload: StreamErrorPayload) => void;
};

type RpcDeps = {
  buildStatusPayload: () => Promise<StatusPayload>;
  isChatRequest: (value: unknown) => value is ChatRequest;
  runChatRequest: (chatRequest: ChatRequest, handlers: RunChatHandlers) => Promise<void>;
  taskRegistry: TaskRegistry;
  transitionTaskState: (
    taskId: string,
    patch: { state?: TaskState; summary?: string },
    meta?: { reason?: TaskTransitionReason; transport?: string },
  ) => void;
};

const rpcQueuePolicy = createSerialPerConnectionQueuePolicy<QueuedRpcChat>({
  queueFullError: (maxQueued) => `RPC queue is full (${maxQueued} queued). Try again shortly.`,
});

let rpcQueuedTaskCount = 0;

export function getRpcQueuedTaskCount(): number {
  return rpcQueuedTaskCount;
}

function parseRpcMessageEnvelope(raw: string | Buffer | Uint8Array): ParsedRpcEnvelope {
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return { id: null, message: null };
  }
  const id =
    typeof parsedJson === "object" &&
    parsedJson !== null &&
    "id" in parsedJson &&
    typeof parsedJson.id === "string" &&
    parsedJson.id.length > 0
      ? parsedJson.id
      : null;
  const parsed = rpcClientMessageSchema.safeParse(parsedJson);
  if (!parsed.success) return { id, message: null };
  return { id: parsed.data.id, message: parsed.data };
}

function runWorkerTask(input: WorkerRunInput, deps: RpcDeps): Promise<void> {
  deps.transitionTaskState(input.taskId, { state: "running" }, { reason: "chat_started", transport: "rpc" });
  log.info("rpc task started", {
    task_id: input.taskId,
    session_id: input.request.sessionId ?? null,
  });
  return deps.runChatRequest(input.request, {
    path: "/v1/rpc",
    method: "WS",
    taskId: input.taskId,
    isCancelled: () => input.state.aborted,
    shouldYield: input.shouldYield,
    onEvent: input.emitEvent,
    onDone: (reply) => {
      deps.transitionTaskState(
        input.taskId,
        {
          state: "completed",
          summary: typeof reply.output === "string" ? reply.output.slice(0, 240) : undefined,
        },
        { reason: "chat_completed", transport: "rpc" },
      );
      input.emitDone(reply);
    },
    onError: (payload) => {
      deps.transitionTaskState(
        input.taskId,
        { state: "failed", summary: payload.error },
        { reason: "chat_failed", transport: "rpc" },
      );
      input.emitError(payload);
    },
  });
}

export function createRpcWebsocketHandlers(deps: RpcDeps): Bun.WebSocketHandler<RpcConnectionState> {
  type RpcHandlerContext = {
    wsData: RpcConnectionState;
    send: (payload: Record<string, unknown>) => void;
    sendForId: (id: string, payload: Record<string, unknown>) => void;
    startChat: (chatId: string, request: ChatRequest, state: ActiveRpcChatState) => void;
  };

  const handleStatusGet = async (
    _msg: Extract<RpcClientMessage, { type: "status.get" }>,
    ctx: RpcHandlerContext,
  ): Promise<void> => {
    ctx.send({ type: "status.result", status: await deps.buildStatusPayload() });
  };

  const handlePermissionsSet = (
    msg: Extract<RpcClientMessage, { type: "permissions.set" }>,
    ctx: RpcHandlerContext,
  ): void => {
    const mode = msg.payload.mode;
    setPermissionMode(mode);
    ctx.send({ type: "permissions.result", permissionMode: appConfig.agent.permissions.mode });
  };

  const handleChatStart = (msg: Extract<RpcClientMessage, { type: "chat.start" }>, ctx: RpcHandlerContext): void => {
    if (ctx.wsData.activeChats.has(msg.id) || ctx.wsData.queue.some((item) => item.id === msg.id)) {
      ctx.send({ type: "error", error: `Chat request already running for id: ${msg.id}` });
      return;
    }
    const request = msg.payload.request;
    if (!deps.isChatRequest(request)) {
      ctx.send({ type: "error", error: "Invalid request shape" });
      return;
    }
    const state: ActiveRpcChatState = { aborted: false };
    const startResult = rpcQueuePolicy.onStart({
      runningChatId: ctx.wsData.runningChatId,
      queue: ctx.wsData.queue,
      entry: { id: msg.id, request, state },
      maxQueued: RPC_MAX_QUEUED_TASKS_PER_CONNECTION,
    });
    if (startResult.type === "rejected") {
      ctx.send({ type: "error", error: startResult.error });
      return;
    }
    deps.transitionTaskState(msg.id, { state: "accepted" }, { reason: "chat_accepted", transport: "rpc" });
    log.info("rpc task accepted", {
      task_id: msg.id,
      session_id: request.sessionId ?? null,
      queued_task_count: ctx.wsData.queue.length,
      has_running_task: Boolean(ctx.wsData.runningChatId),
    });
    ctx.send({ type: "chat.accepted" });
    if (startResult.type === "queued") {
      deps.transitionTaskState(msg.id, { state: "queued" }, { reason: "chat_accepted", transport: "rpc" });
      rpcQueuedTaskCount += 1;
      log.info("rpc task queued", {
        task_id: msg.id,
        queue_position: startResult.position,
        running_task_id: ctx.wsData.runningChatId,
      });
      ctx.send({ type: "chat.queued", position: startResult.position });
      return;
    }
    ctx.startChat(msg.id, request, state);
  };

  const handleChatAbort = (msg: Extract<RpcClientMessage, { type: "chat.abort" }>, ctx: RpcHandlerContext): void => {
    const requestId = msg.payload.requestId;
    const activeState = ctx.wsData.activeChats.get(requestId);
    if (activeState) {
      activeState.aborted = true;
      deps.transitionTaskState(
        requestId,
        { state: "cancelled", summary: "Cancelled by client request." },
        { reason: "abort_requested", transport: "rpc" },
      );
      log.info("rpc task abort acknowledged", { task_id: requestId, state: "running" });
      ctx.send({ type: "chat.abort.result", requestId, aborted: true });
      return;
    }
    const queueResult = rpcQueuePolicy.onAbort(ctx.wsData.queue, requestId);
    if (queueResult.removed) {
      rpcQueuedTaskCount = Math.max(0, rpcQueuedTaskCount - 1);
      deps.transitionTaskState(
        requestId,
        { state: "cancelled", summary: "Cancelled while queued." },
        { reason: "abort_requested", transport: "rpc" },
      );
      log.info("rpc task abort acknowledged", { task_id: requestId, state: "queued" });
      for (const update of queueResult.updates) {
        ctx.sendForId(update.id, { type: "chat.queued", position: update.position });
        log.info("rpc task reindexed", { task_id: update.id, queue_position: update.position });
      }
      ctx.send({ type: "chat.abort.result", requestId, aborted: true });
      return;
    }
    log.info("rpc task abort ignored", { task_id: requestId });
    ctx.send({ type: "chat.abort.result", requestId, aborted: false });
  };

  const handleTaskStatus = (msg: Extract<RpcClientMessage, { type: "task.status" }>, ctx: RpcHandlerContext): void => {
    ctx.send({ type: "task.status.result", task: deps.taskRegistry.get(msg.payload.taskId) });
  };

  return {
    close(ws) {
      log.info("rpc connection closed", {
        active_task_count: ws.data.activeChats.size,
        queued_task_count: ws.data.queue.length,
      });
      for (const [taskId, state] of ws.data.activeChats.entries()) {
        state.aborted = true;
        deps.transitionTaskState(
          taskId,
          { state: "cancelled", summary: "Connection closed before completion." },
          { reason: "connection_closed", transport: "rpc" },
        );
        log.info("rpc task cancelled on disconnect", { task_id: taskId, state: "running" });
      }
      for (const item of ws.data.queue) {
        item.state.aborted = true;
        deps.transitionTaskState(
          item.id,
          { state: "cancelled", summary: "Connection closed while queued." },
          { reason: "connection_closed", transport: "rpc" },
        );
        log.info("rpc task cancelled on disconnect", { task_id: item.id, state: "queued" });
      }
      rpcQueuedTaskCount = Math.max(0, rpcQueuedTaskCount - ws.data.queue.length);
      ws.data.queue = [];
      ws.data.runningChatId = null;
    },

    async message(ws, raw) {
      if (!ws.data.authed) {
        ws.close(1008, "unauthorized");
        return;
      }
      const envelope = parseRpcMessageEnvelope(raw);
      if (!envelope.message) {
        ws.send(JSON.stringify({ id: envelope.id ?? "unknown", type: "error", error: "Invalid RPC message" }));
        return;
      }
      const message = envelope.message;

      const sendForId = (id: string, payload: Record<string, unknown>): void => {
        ws.send(JSON.stringify({ id, ...payload }));
      };
      const send = (payload: Record<string, unknown>): void => sendForId(message.id, payload);

      const startChat = (chatId: string, request: ChatRequest, state: ActiveRpcChatState): void => {
        ws.data.runningChatId = chatId;
        ws.data.activeChats.set(chatId, state);
        log.info("rpc worker task scheduled", {
          task_id: chatId,
          session_id: request.sessionId ?? null,
          queued_task_count: ws.data.queue.length,
        });
        sendForId(chatId, { type: "chat.started" });
        void runWorkerTask(
          {
            taskId: chatId,
            request,
            state,
            shouldYield: () => rpcQueuePolicy.shouldYield(ws.data.queue),
            emitEvent: (event) => sendForId(chatId, { type: "chat.event", event }),
            emitDone: (reply) => sendForId(chatId, { type: "chat.done", reply }),
            emitError: (payload) => sendForId(chatId, { type: "chat.error", ...payload }),
          },
          deps,
        ).finally(() => {
          ws.data.activeChats.delete(chatId);
          if (ws.data.runningChatId === chatId) ws.data.runningChatId = null;
          const queuedBefore = ws.data.queue.length;
          const dequeue = rpcQueuePolicy.onFinished(ws.data.queue);
          const removedFromQueue = queuedBefore - ws.data.queue.length;
          rpcQueuedTaskCount = Math.max(0, rpcQueuedTaskCount - removedFromQueue);
          for (const update of dequeue.updates) {
            sendForId(update.id, { type: "chat.queued", position: update.position });
            log.info("rpc task reindexed", { task_id: update.id, queue_position: update.position });
          }
          if (dequeue.next) {
            log.info("rpc task dequeued", { task_id: dequeue.next.id });
            startChat(dequeue.next.id, dequeue.next.request, dequeue.next.state);
          }
        });
      };

      const context: RpcHandlerContext = { wsData: ws.data, send, sendForId, startChat };
      const handlers: RpcHandlerMap = {
        "status.get": (msg) => handleStatusGet(msg, context),
        "permissions.set": (msg) => handlePermissionsSet(msg, context),
        "chat.start": (msg) => handleChatStart(msg, context),
        "chat.abort": (msg) => handleChatAbort(msg, context),
        "task.status": (msg) => handleTaskStatus(msg, context),
      };

      const handler = handlers[message.type];
      if (!handler) {
        send({ type: "error", error: "Unsupported RPC method" });
        return;
      }
      await handler(message as never);
    },
  };
}
