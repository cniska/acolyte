import type { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { log } from "./log";
import { type RpcRequestId, rpcClientMessageSchema, rpcRequestIdSchema } from "./rpc-protocol";
import { createSerialPerConnectionQueuePolicy } from "./rpc-queue";
import type { RunChatHandlers, StatusPayload, StreamErrorPayload } from "./server-contract";
import { createId } from "./short-id";
import { type TaskId, type TaskState, type TaskTransitionReason, taskIdSchema } from "./task-contract";
import type { TaskRegistry } from "./task-registry";

const RPC_MAX_QUEUED_TASKS_PER_CONNECTION = 25;

export type ActiveRpcChatState = {
  aborted: boolean;
  taskId: TaskId;
};

export type QueuedRpcChat = {
  id: RpcRequestId;
  request: ChatRequest;
  state: ActiveRpcChatState;
};

export type RpcConnectionState = {
  authed: boolean;
  activeChats: Map<RpcRequestId, ActiveRpcChatState>;
  runningChatId: RpcRequestId | null;
  queue: QueuedRpcChat[];
};

type ParsedRpcEnvelope = {
  id: RpcRequestId | null;
  message: z.infer<typeof rpcClientMessageSchema> | null;
};
type RpcClientMessage = z.infer<typeof rpcClientMessageSchema>;
type RpcHandlerMap = {
  [K in RpcClientMessage["type"]]: (msg: Extract<RpcClientMessage, { type: K }>) => Promise<void> | void;
};

type WorkerRunInput = {
  taskId: TaskId;
  request: ChatRequest;
  state: ActiveRpcChatState;
  shouldYield: () => boolean;
  emitEvent: (event: Record<string, unknown>) => void;
  emitDone: (reply: ChatResponse) => void;
  emitError: (payload: StreamErrorPayload) => void;
};

type RpcDeps = {
  createStatusPayload: () => Promise<StatusPayload>;
  isChatRequest: (value: unknown) => value is ChatRequest;
  runChatRequest: (chatRequest: ChatRequest, handlers: RunChatHandlers) => Promise<void>;
  taskRegistry: TaskRegistry;
  transitionTaskState: (
    taskId: TaskId,
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

function nextTaskId(): TaskId {
  return taskIdSchema.parse(`task_${createId()}`);
}

function parseRpcMessageEnvelope(raw: string | Buffer | Uint8Array): ParsedRpcEnvelope {
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return { id: null, message: null };
  }
  const idCandidate =
    typeof parsedJson === "object" &&
    parsedJson !== null &&
    "id" in parsedJson &&
    typeof parsedJson.id === "string" &&
    parsedJson.id.length > 0
      ? parsedJson.id
      : null;
  const id = idCandidate && rpcRequestIdSchema.safeParse(idCandidate).success ? idCandidate : null;
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
    sendForId: (id: RpcRequestId, payload: Record<string, unknown>) => void;
    startChat: (requestId: RpcRequestId, request: ChatRequest, state: ActiveRpcChatState) => void;
  };

  const handleStatusGet = async (
    _msg: Extract<RpcClientMessage, { type: "status.get" }>,
    ctx: RpcHandlerContext,
  ): Promise<void> => {
    ctx.send({ type: "status.result", status: await deps.createStatusPayload() });
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

    const state: ActiveRpcChatState = { aborted: false, taskId: nextTaskId() };
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

    deps.transitionTaskState(state.taskId, { state: "accepted" }, { reason: "chat_accepted", transport: "rpc" });
    log.info("rpc task accepted", {
      task_id: state.taskId,
      session_id: request.sessionId ?? null,
      queued_task_count: ctx.wsData.queue.length,
      has_running_task: Boolean(ctx.wsData.runningChatId),
    });
    ctx.send({ type: "chat.accepted", taskId: state.taskId });

    if (startResult.type === "queued") {
      deps.transitionTaskState(state.taskId, { state: "queued" }, { reason: "chat_accepted", transport: "rpc" });
      rpcQueuedTaskCount += 1;
      log.info("rpc task queued", {
        task_id: state.taskId,
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
        activeState.taskId,
        { state: "cancelled", summary: "Cancelled by client request." },
        { reason: "abort_requested", transport: "rpc" },
      );
      log.info("rpc task abort acknowledged", { task_id: activeState.taskId, state: "running" });
      ctx.send({ type: "chat.abort.result", requestId, aborted: true });
      return;
    }

    const queuedItem = ctx.wsData.queue.find((item) => item.id === requestId);
    const queueResult = rpcQueuePolicy.onAbort(ctx.wsData.queue, requestId);
    if (queueResult.removed) {
      rpcQueuedTaskCount = Math.max(0, rpcQueuedTaskCount - 1);
      if (queuedItem)
        deps.transitionTaskState(
          queuedItem.state.taskId,
          { state: "cancelled", summary: "Cancelled while queued." },
          { reason: "abort_requested", transport: "rpc" },
        );
      log.info("rpc task abort acknowledged", { task_id: queuedItem?.state.taskId ?? null, state: "queued" });
      for (const update of queueResult.updates) {
        const requestId = update.id as RpcRequestId;
        ctx.sendForId(requestId, { type: "chat.queued", position: update.position });
        const updatedTaskId = ctx.wsData.queue.find((item) => item.id === requestId)?.state.taskId ?? null;
        log.info("rpc task reindexed", { task_id: updatedTaskId, queue_position: update.position });
      }
      ctx.send({ type: "chat.abort.result", requestId, aborted: true });
      return;
    }

    log.info("rpc task abort ignored", { request_id: requestId });
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
      for (const [requestId, state] of ws.data.activeChats.entries()) {
        state.aborted = true;
        deps.transitionTaskState(
          state.taskId,
          { state: "cancelled", summary: "Connection closed before completion." },
          { reason: "connection_closed", transport: "rpc" },
        );
        log.info("rpc task cancelled on disconnect", {
          task_id: state.taskId,
          request_id: requestId,
          state: "running",
        });
      }
      for (const item of ws.data.queue) {
        item.state.aborted = true;
        deps.transitionTaskState(
          item.state.taskId,
          { state: "cancelled", summary: "Connection closed while queued." },
          { reason: "connection_closed", transport: "rpc" },
        );
        log.info("rpc task cancelled on disconnect", {
          task_id: item.state.taskId,
          request_id: item.id,
          state: "queued",
        });
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
        ws.send(JSON.stringify({ id: envelope.id ?? "rpc_unknown", type: "error", error: "Invalid RPC message" }));
        return;
      }
      const message = envelope.message;

      const sendForId = (id: RpcRequestId, payload: Record<string, unknown>): void => {
        ws.send(JSON.stringify({ id, ...payload }));
      };
      const send = (payload: Record<string, unknown>): void => sendForId(message.id, payload);

      const startChat = (requestId: RpcRequestId, request: ChatRequest, state: ActiveRpcChatState): void => {
        ws.data.runningChatId = requestId;
        ws.data.activeChats.set(requestId, state);
        log.info("rpc worker task scheduled", {
          task_id: state.taskId,
          session_id: request.sessionId ?? null,
          queued_task_count: ws.data.queue.length,
        });
        sendForId(requestId, { type: "chat.started" });
        void runWorkerTask(
          {
            taskId: state.taskId,
            request,
            state,
            shouldYield: () => rpcQueuePolicy.shouldYield(ws.data.queue),
            emitEvent: (event) => sendForId(requestId, { type: "chat.event", event }),
            emitDone: (reply) => sendForId(requestId, { type: "chat.done", reply }),
            emitError: (payload) => sendForId(requestId, { type: "chat.error", ...payload }),
          },
          deps,
        ).finally(() => {
          ws.data.activeChats.delete(requestId);
          if (ws.data.runningChatId === requestId) ws.data.runningChatId = null;
          const queuedBefore = ws.data.queue.length;
          const dequeue = rpcQueuePolicy.onFinished(ws.data.queue);
          const removedFromQueue = queuedBefore - ws.data.queue.length;
          rpcQueuedTaskCount = Math.max(0, rpcQueuedTaskCount - removedFromQueue);
          for (const update of dequeue.updates) {
            const updateRequestId = update.id as RpcRequestId;
            sendForId(updateRequestId, { type: "chat.queued", position: update.position });
            const updatedTaskId = ws.data.queue.find((item) => item.id === updateRequestId)?.state.taskId ?? null;
            log.info("rpc task reindexed", { task_id: updatedTaskId, queue_position: update.position });
          }
          if (dequeue.next) {
            log.info("rpc task dequeued", { task_id: dequeue.next.state.taskId });
            startChat(dequeue.next.id, dequeue.next.request, dequeue.next.state);
          }
        });
      };

      const context: RpcHandlerContext = { wsData: ws.data, send, sendForId, startChat };
      const handlers: RpcHandlerMap = {
        "status.get": (msg) => handleStatusGet(msg, context),
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
