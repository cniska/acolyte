#!/usr/bin/env bun
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { z } from "zod";
import { runAgent } from "./agent";
import { type ChatRequest, verifyScopeSchema } from "./api";
import { appConfig, setPermissionMode } from "./app-config";
import { createDebugLogger } from "./debug-flags";
import { buildStreamErrorDetail } from "./error-handling";
import { errorToLogFields, log } from "./log";
import { mastraStorage, mastraStorageMode } from "./mastra-storage";
import { getObservationalMemoryConfig } from "./memory-config";
import { formatServerCapabilities, PROTOCOL_VERSION } from "./protocol";
import { formatModel, isProviderAvailable, providerFromModel, resolveProvider } from "./provider-config";
import { rpcClientMessageSchema, statusPayloadSchema } from "./rpc-protocol";
import { createSerialPerConnectionQueuePolicy } from "./rpc-queue";
import { createId } from "./short-id";
import { createSoulPrompt, getMemoryContextEntries } from "./soul";
import type { StreamErrorDetail } from "./stream-error";
import { TaskRegistry } from "./task-registry";
import type { TaskTransitionReason } from "./task-state";
import { extractToolErrorCode } from "./tool-error-codes";

const PORT = appConfig.server.port;
const API_KEY = appConfig.server.apiKey;
const OPENAI_API_KEY = appConfig.openai.apiKey;
const OPENAI_BASE_URL = appConfig.openai.baseUrl;
const omConfig = getObservationalMemoryConfig();
const SUPPRESSED_STDERR_PREFIX = "Upstream LLM API error from";
const SERVER_IDLE_TIMEOUT_SECONDS = Math.max(30, Math.ceil(appConfig.server.replyTimeoutMs / 1000) + 30);
const RPC_MAX_QUEUED_TASKS_PER_CONNECTION = 25;
const taskRegistry = new TaskRegistry();
let rpcQueuedTaskCount = 0;
const debug = createDebugLogger({
  scope: "server",
  sink: (line) => log.debug(line),
});

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]): void => {
  const first = args[0];
  if (typeof first === "string" && first.includes(SUPPRESSED_STDERR_PREFIX)) return;
  originalConsoleError(...args);
};

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function nextErrorId(): string {
  return `err_${createId()}`;
}

function streamErrorPayload(error: unknown): { error: string; errorCode?: string; errorDetail?: StreamErrorDetail } {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const extractedCode = extractToolErrorCode(errorMessage);
  const { errorCode, errorDetail } = buildStreamErrorDetail(
    {
      message: errorMessage,
      code: extractedCode,
      source: "server",
      unknownErrorCount: 1,
    },
    1,
  );
  return {
    error: errorMessage,
    errorCode,
    errorDetail,
  };
}

function serverError(
  message: string,
  error: unknown,
  details: Record<string, string | number | boolean | null | undefined>,
  status = 500,
): Response {
  const errorId = nextErrorId();
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const errorMessageLower = errorMessage.toLowerCase();
  const publicMessage =
    errorMessageLower.includes("insufficient_quota") || errorMessageLower.includes("exceeded your current quota")
      ? "Provider quota exceeded. Add billing/credits or switch model/provider."
      : errorMessage;
  const { errorCode, errorDetail } = buildStreamErrorDetail(
    {
      message: publicMessage,
      source: "server",
      unknownErrorCount: 1,
    },
    1,
  );
  log.error(message, {
    error_id: errorId,
    ...details,
    ...errorToLogFields(error),
  });
  return json({ error: publicMessage, errorId, errorCode, errorDetail }, status);
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;

  const req = value as Partial<ChatRequest>;
  return (
    typeof req.message === "string" &&
    typeof req.model === "string" &&
    Array.isArray(req.history) &&
    (req.sessionId === undefined || typeof req.sessionId === "string") &&
    (req.resourceId === undefined || typeof req.resourceId === "string") &&
    (req.useMemory === undefined || typeof req.useMemory === "boolean") &&
    (req.skipAutoVerify === undefined || typeof req.skipAutoVerify === "boolean") &&
    (req.verifyScope === undefined || verifyScopeSchema.safeParse(req.verifyScope).success) &&
    (req.workspace === undefined || typeof req.workspace === "string")
  );
}

type WorkspaceResolution = {
  workspacePath: string;
  workspaceMode: "default" | "path";
};

type StatusPayload = z.infer<typeof statusPayloadSchema>;

function resolveWorkspacePath(request: Pick<ChatRequest, "workspace">): WorkspaceResolution {
  if (!request.workspace) return { workspacePath: resolve(process.cwd()), workspaceMode: "default" };
  const resolved = resolve(request.workspace);
  if (!existsSync(resolved)) throw new Error(`Workspace path does not exist: ${resolved}`);
  if (!statSync(resolved).isDirectory()) throw new Error(`Workspace path is not a directory: ${resolved}`);
  return { workspacePath: resolved, workspaceMode: "path" };
}

function hasValidAuth(req: Request, url?: URL): boolean {
  if (!API_KEY) return true;

  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${API_KEY}`) return true;
  return url?.searchParams.get("apiKey") === API_KEY;
}

function resolveResourceId(url: URL): string {
  const candidate = url.searchParams.get("resourceId")?.trim();
  if (candidate) return candidate;
  return appConfig.memory.resourceId;
}

function transitionTaskState(
  taskId: string,
  patch: { state?: "running" | "detached" | "completed" | "failed" | "cancelled"; summary?: string },
  meta?: { reason?: TaskTransitionReason; transport?: string },
): void {
  const previous = taskRegistry.get(taskId);
  const result = taskRegistry.transitionTask(taskId, patch);
  if (!result.ok) {
    log.warn("task state transition rejected", {
      task_id: taskId,
      code: result.code,
      from_state: result.fromState,
      to_state: result.toState,
      reason: meta?.reason ?? null,
      transport: meta?.transport ?? null,
    });
    return;
  }
  const next = result.task;
  log.info("task state updated", {
    task_id: taskId,
    from_state: previous?.state ?? null,
    to_state: next.state,
    reason: meta?.reason ?? null,
    transport: meta?.transport ?? null,
  });
}

async function buildStatusPayload(): Promise<StatusPayload> {
  const model = appConfig.model;
  const providerConfig = {
    openaiApiKey: OPENAI_API_KEY,
    openaiBaseUrl: OPENAI_BASE_URL,
    anthropicApiKey: appConfig.anthropic.apiKey,
    googleApiKey: appConfig.google.apiKey,
  };
  const modelProvider = providerFromModel(model);
  const provider = modelProvider === "openai" ? resolveProvider(OPENAI_API_KEY, OPENAI_BASE_URL) : modelProvider;
  const memoryContextCount = (await getMemoryContextEntries()).length;
  const taskSummary = taskRegistry.summary();
  return {
    ok: true,
    provider,
    model: formatModel(model),
    protocolVersion: PROTOCOL_VERSION,
    capabilities: formatServerCapabilities(),
    permissions: appConfig.agent.permissions.mode,
    service: `http://localhost:${PORT}`,
    memory: memoryContextCount > 0 ? `${mastraStorageMode} (${memoryContextCount} entries)` : mastraStorageMode,
    observational_memory: `enabled (${omConfig.scope})`,
    tasks_total: taskSummary.total,
    tasks_running: taskSummary.running,
    tasks_detached: taskSummary.detached,
    rpc_queue_length: rpcQueuedTaskCount,
  };
}

function providerConfigurationHint(provider: "openai" | "openai-compatible" | "anthropic" | "gemini"): string {
  if (provider === "openai-compatible") return "Configure openaiBaseUrl to your compatible endpoint.";
  if (provider === "anthropic") return "Set ANTHROPIC_API_KEY.";
  if (provider === "gemini") return "Set GOOGLE_API_KEY.";
  return "Set OPENAI_API_KEY (or use openai-compatible/<model> with a local endpoint).";
}

type RunChatHandlers = {
  path: string;
  method: string;
  taskId?: string;
  onEvent: (event: Record<string, unknown>) => void;
  onDone: (reply: Awaited<ReturnType<typeof runAgent>>) => void;
  onError: (payload: ReturnType<typeof streamErrorPayload>) => void;
  isCancelled?: () => boolean;
  shouldYield?: () => boolean;
};

async function runChatRequest(chatRequest: ChatRequest, handlers: RunChatHandlers): Promise<void> {
  const requestId = nextErrorId();
  const startedAt = Date.now();
  const modelProvider = providerFromModel(chatRequest.model);
  const providerReady = isProviderAvailable({
    provider: modelProvider,
    openaiApiKey: OPENAI_API_KEY,
    openaiBaseUrl: OPENAI_BASE_URL,
    anthropicApiKey: appConfig.anthropic.apiKey,
    googleApiKey: appConfig.google.apiKey,
  });
  if (!providerReady) {
    const payload = streamErrorPayload(
      new Error(
        `No provider is configured for model "${chatRequest.model}". ${providerConfigurationHint(modelProvider)}`,
      ),
    );
    handlers.onError(payload);
    return;
  }

  let workspaceResolution: WorkspaceResolution;
  try {
    workspaceResolution = resolveWorkspacePath(chatRequest);
  } catch (error) {
    const payload = streamErrorPayload(error);
    handlers.onError(payload);
    return;
  }

  log.info("chat request started", {
    request_id: requestId,
    task_id: handlers.taskId ?? null,
    session_id: chatRequest.sessionId ?? null,
    model: chatRequest.model,
    history_messages: chatRequest.history.length,
    message_chars: chatRequest.message.length,
    has_resource_id: Boolean(chatRequest.resourceId),
    workspace_mode: workspaceResolution.workspaceMode,
    transport_path: handlers.path,
  });

  try {
    const soulPrompt = await createSoulPrompt();
    const reply = await runAgent({
      request: chatRequest,
      soulPrompt,
      workspace: workspaceResolution.workspacePath,
      taskId: handlers.taskId,
      shouldYield: handlers.shouldYield,
      onEvent: (event) => {
        if (handlers.isCancelled?.()) return;
        if ((event as { type?: string }).type === "tool-output")
          debug.log("tool-stream-forward", {
            task_id: handlers.taskId ?? null,
            type: "tool-output",
            tool: (event as { toolName?: unknown }).toolName,
            tool_call_id: (event as { toolCallId?: unknown }).toolCallId,
          });
        handlers.onEvent(event as Record<string, unknown>);
      },
      onDebug: (entry) => {
        log.info("agent debug", {
          request_id: requestId,
          task_id: handlers.taskId ?? null,
          session_id: chatRequest.sessionId ?? null,
          event: entry.event,
          sequence: entry.sequence,
          phase_attempt: entry.phaseAttempt,
          event_ts: entry.ts,
          ...(entry.fields ?? {}),
        });
      },
    });
    if (handlers.isCancelled?.()) {
      log.info("chat request cancelled", {
        request_id: requestId,
        task_id: handlers.taskId ?? null,
        session_id: chatRequest.sessionId ?? null,
        transport_path: handlers.path,
      });
      return;
    }
    const durationMs = Date.now() - startedAt;
    log.info("chat request completed", {
      request_id: requestId,
      task_id: handlers.taskId ?? null,
      session_id: chatRequest.sessionId ?? null,
      model: reply.model,
      duration_ms: durationMs,
      model_calls: reply.modelCalls ?? null,
      tool_count: reply.toolCalls?.length ?? 0,
      tools: reply.toolCalls?.join(",") ?? "",
      prompt_tokens: reply.usage?.promptTokens ?? null,
      completion_tokens: reply.usage?.completionTokens ?? null,
      stream: true,
      transport_path: handlers.path,
    });
    handlers.onDone(reply);
  } catch (error) {
    if (handlers.isCancelled?.()) return;
    const payload = streamErrorPayload(error);
    log.error("chat stream failed", {
      request_id: requestId,
      task_id: handlers.taskId ?? null,
      session_id: chatRequest.sessionId ?? null,
      path: handlers.path,
      method: handlers.method,
      model: chatRequest.model,
      ...errorToLogFields(error),
    });
    handlers.onError(payload);
  }
}

type ActiveRpcChatState = {
  aborted: boolean;
};

type QueuedRpcChat = {
  id: string;
  request: ChatRequest;
  state: ActiveRpcChatState;
};

const rpcQueuePolicy = createSerialPerConnectionQueuePolicy<QueuedRpcChat>({
  queueFullError: (maxQueued) => `RPC queue is full (${maxQueued} queued). Try again shortly.`,
});

type RpcConnectionState = {
  authed: boolean;
  activeChats: Map<string, ActiveRpcChatState>;
  runningChatId: string | null;
  queue: QueuedRpcChat[];
};

type WorkerRunInput = {
  taskId: string;
  request: ChatRequest;
  state: ActiveRpcChatState;
  shouldYield: () => boolean;
  emitEvent: (event: Record<string, unknown>) => void;
  emitDone: (reply: Awaited<ReturnType<typeof runAgent>>) => void;
  emitError: (payload: ReturnType<typeof streamErrorPayload>) => void;
};

function runWorkerTask(input: WorkerRunInput): Promise<void> {
  transitionTaskState(input.taskId, { state: "running" }, { reason: "chat_started", transport: "rpc" });
  log.info("rpc task started", {
    task_id: input.taskId,
    session_id: input.request.sessionId ?? null,
  });
  return runChatRequest(input.request, {
    path: "/v1/rpc",
    method: "WS",
    taskId: input.taskId,
    isCancelled: () => input.state.aborted,
    shouldYield: input.shouldYield,
    onEvent: input.emitEvent,
    onDone: (reply) => {
      transitionTaskState(
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
      transitionTaskState(
        input.taskId,
        { state: "failed", summary: payload.error },
        { reason: "chat_failed", transport: "rpc" },
      );
      input.emitError(payload);
    },
  });
}

type ParsedRpcEnvelope = {
  id: string | null;
  message: z.infer<typeof rpcClientMessageSchema> | null;
};
type RpcClientMessage = z.infer<typeof rpcClientMessageSchema>;
type RpcHandlerMap = {
  [K in RpcClientMessage["type"]]: (msg: Extract<RpcClientMessage, { type: K }>) => Promise<void> | void;
};
type RpcHandlerContext = {
  wsData: RpcConnectionState;
  send: (payload: Record<string, unknown>) => void;
  sendForId: (id: string, payload: Record<string, unknown>) => void;
  startChat: (chatId: string, request: ChatRequest, state: ActiveRpcChatState) => void;
};

async function handleStatusGet(_msg: Extract<RpcClientMessage, { type: "status.get" }>, ctx: RpcHandlerContext): Promise<void> {
  ctx.send({ type: "status.result", status: await buildStatusPayload() });
}

function handlePermissionsSet(msg: Extract<RpcClientMessage, { type: "permissions.set" }>, ctx: RpcHandlerContext): void {
  const mode = msg.payload.mode;
  setPermissionMode(mode);
  ctx.send({ type: "permissions.result", permissionMode: appConfig.agent.permissions.mode });
}

function handleChatStart(msg: Extract<RpcClientMessage, { type: "chat.start" }>, ctx: RpcHandlerContext): void {
  if (ctx.wsData.activeChats.has(msg.id) || ctx.wsData.queue.some((item) => item.id === msg.id)) {
    ctx.send({ type: "error", error: `Chat request already running for id: ${msg.id}` });
    return;
  }
  const request = msg.payload.request;
  if (!isChatRequest(request)) {
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
  transitionTaskState(msg.id, { state: "running" }, { reason: "chat_accepted", transport: "rpc" });
  log.info("rpc task accepted", {
    task_id: msg.id,
    session_id: request.sessionId ?? null,
    queued_task_count: ctx.wsData.queue.length,
    has_running_task: Boolean(ctx.wsData.runningChatId),
  });
  ctx.send({ type: "chat.accepted" });
  if (startResult.type === "queued") {
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
}

function handleChatAbort(msg: Extract<RpcClientMessage, { type: "chat.abort" }>, ctx: RpcHandlerContext): void {
  const requestId = msg.payload.requestId;
  const activeState = ctx.wsData.activeChats.get(requestId);
  if (activeState) {
    activeState.aborted = true;
    transitionTaskState(
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
    transitionTaskState(
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
}

function handleTaskStatus(msg: Extract<RpcClientMessage, { type: "task.status" }>, ctx: RpcHandlerContext): void {
  ctx.send({ type: "task.status.result", task: taskRegistry.get(msg.payload.taskId) });
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

try {
  await mastraStorage.init();
} catch (error) {
  log.error("failed to initialize Mastra storage", {
    ...errorToLogFields(error),
  });
  process.exit(1);
}

const server = Bun.serve<RpcConnectionState>({
  port: PORT,
  idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/v1/status" && req.method === "GET") {
      return json(await buildStatusPayload());
    }

    if (url.pathname === "/v1/admin/om/status" && req.method === "GET") {
      if (!hasValidAuth(req)) {
        log.warn("unauthorized request", {
          path: url.pathname,
          method: req.method,
        });
        return unauthorized();
      }
      try {
        const memoryStore = await mastraStorage.getStore("memory");
        if (!memoryStore) return json({ error: "Memory storage is not available." }, 501);
        const resourceId = resolveResourceId(url);
        log.info("om status requested", {
          path: url.pathname,
          method: req.method,
          resource_id: resourceId,
        });
        const current = await memoryStore.getObservationalMemory(null, resourceId);
        const history = await memoryStore.getObservationalMemoryHistory(null, resourceId, 10);
        const latestReflection = history.find((row) => row.originType === "reflection");
        const observations =
          current?.activeObservations
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0) ?? [];
        return json({
          ok: true,
          resourceId,
          exists: Boolean(current),
          generationCount: current?.generationCount ?? 0,
          lastObservedAt: current?.lastObservedAt ?? null,
          lastReflectionAt: latestReflection?.createdAt ?? null,
          observations: observations.slice(0, 5),
          historyCount: history.length,
        });
      } catch (error) {
        return serverError("om status failed", error, { path: url.pathname, method: req.method }, 500);
      }
    }

    if (url.pathname === "/v1/admin/om/wipe" && req.method === "POST") {
      if (!hasValidAuth(req)) {
        log.warn("unauthorized request", {
          path: url.pathname,
          method: req.method,
        });
        return unauthorized();
      }
      try {
        const memoryStore = await mastraStorage.getStore("memory");
        if (!memoryStore) return json({ error: "Memory storage is not available." }, 501);
        const resourceId = resolveResourceId(url);
        log.warn("om wipe requested", {
          path: url.pathname,
          method: req.method,
          resource_id: resourceId,
        });
        await memoryStore.clearObservationalMemory(null, resourceId);
        log.info("om wipe completed", {
          path: url.pathname,
          method: req.method,
          resource_id: resourceId,
        });
        return json({ ok: true, resourceId, wiped: true });
      } catch (error) {
        return serverError("om wipe failed", error, { path: url.pathname, method: req.method }, 500);
      }
    }

    if (url.pathname === "/v1/permissions" && req.method === "POST") {
      if (!hasValidAuth(req)) {
        log.warn("unauthorized request", {
          path: url.pathname,
          method: req.method,
        });
        return unauthorized();
      }
      let payload: unknown;
      try {
        payload = await req.json();
      } catch {
        return badRequest("Invalid JSON body");
      }
      const mode = (payload as { mode?: unknown })?.mode;
      if (mode !== "read" && mode !== "write") return badRequest("Invalid permission mode. Expected read or write.");
      setPermissionMode(mode);
      log.info("permission mode updated", {
        path: url.pathname,
        method: req.method,
        permission_mode: appConfig.agent.permissions.mode,
      });
      return json({ ok: true, permissionMode: appConfig.agent.permissions.mode });
    }

    if (url.pathname === "/v1/rpc") {
      if (!hasValidAuth(req, url)) {
        log.warn("unauthorized request", {
          path: url.pathname,
          method: req.method,
        });
        return unauthorized();
      }
      if (server.upgrade(req, { data: { authed: true, activeChats: new Map(), runningChatId: null, queue: [] } }))
        return;
      return badRequest("WebSocket upgrade failed");
    }

    const isChatStreamRoute = url.pathname === "/v1/chat/stream" && req.method === "POST";
    if (!isChatStreamRoute) return new Response("Not Found", { status: 404 });

    if (!hasValidAuth(req)) {
      log.warn("unauthorized request", {
        path: url.pathname,
        method: req.method,
      });
      return unauthorized();
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      log.warn("invalid json body", {
        path: url.pathname,
        method: req.method,
      });
      return badRequest("Invalid JSON body");
    }

    if (!isChatRequest(payload)) {
      log.warn("invalid chat request shape", {
        path: url.pathname,
        method: req.method,
      });
      return badRequest("Invalid request shape");
    }

    const chatRequest = payload as ChatRequest;

    const encoder = new TextEncoder();
    let closed = false;
    const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (payload: Record<string, unknown>): void => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            closed = true;
          }
        };
        const keepaliveId = setInterval(() => {
          if (closed) {
            clearInterval(keepaliveId);
            return;
          }
          try {
            controller.enqueue(encoder.encode(":\n\n"));
          } catch {
            closed = true;
            clearInterval(keepaliveId);
          }
        }, SSE_KEEPALIVE_INTERVAL_MS);
        void (async () => {
          try {
            await runChatRequest(chatRequest, {
              path: url.pathname,
              method: req.method,
              onEvent: (event) => send(event),
              onDone: (reply) => send({ type: "done", reply }),
              onError: (payload) => send({ type: "error", ...payload }),
            });
          } finally {
            clearInterval(keepaliveId);
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                // Stream already closed by client disconnect or idle timeout.
              }
            }
          }
        })();
      },
      cancel() {
        closed = true;
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  },
  websocket: {
    close(ws) {
      log.info("rpc connection closed", {
        active_task_count: ws.data.activeChats.size,
        queued_task_count: ws.data.queue.length,
      });
      for (const [taskId, state] of ws.data.activeChats.entries()) {
        state.aborted = true;
        transitionTaskState(
          taskId,
          { state: "cancelled", summary: "Connection closed before completion." },
          { reason: "connection_closed", transport: "rpc" },
        );
        log.info("rpc task cancelled on disconnect", { task_id: taskId, state: "running" });
      }
      for (const item of ws.data.queue) {
        item.state.aborted = true;
        transitionTaskState(
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
        void runWorkerTask({
          taskId: chatId,
          request,
          state,
          shouldYield: () => rpcQueuePolicy.shouldYield(ws.data.queue),
          emitEvent: (event) => sendForId(chatId, { type: "chat.event", event }),
          emitDone: (reply) => sendForId(chatId, { type: "chat.done", reply }),
          emitError: (payload) => sendForId(chatId, { type: "chat.error", ...payload }),
        }).finally(() => {
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
  },
});

process.on("uncaughtException", (error) => {
  log.error("uncaught exception", errorToLogFields(error));
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", errorToLogFields(reason instanceof Error ? reason : new Error(String(reason))));
});

log.info("Acolyte server listening", { url: `http://localhost:${server.port}` });
