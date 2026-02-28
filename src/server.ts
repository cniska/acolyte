#!/usr/bin/env bun
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { z } from "zod";
import { runAgent } from "./agent";
import type { ChatRequest } from "./api";
import { appConfig, setPermissionMode } from "./app-config";
import { buildStreamErrorDetail } from "./error-handling";
import { errorToLogFields, log } from "./log";
import { mastraStorage, mastraStorageMode } from "./mastra-storage";
import { getObservationalMemoryConfig } from "./memory-config";
import { formatServerCapabilities, PROTOCOL_VERSION } from "./protocol";
import { formatModel, isProviderAvailable, providerFromModel, resolveProvider } from "./provider-config";
import { rpcClientMessageSchema } from "./rpc-protocol";
import { dequeueNextQueuedChat, queuePositionUpdates, removeQueuedChatById } from "./rpc-queue";
import { createId } from "./short-id";
import { createSoulPrompt, getMemoryContextEntries } from "./soul";
import type { StreamErrorDetail } from "./stream-error";
import { TaskRegistry } from "./task-registry";
import { extractToolErrorCode } from "./tool-error-codes";

const PORT = appConfig.server.port;
const API_KEY = appConfig.server.apiKey;
const OPENAI_API_KEY = appConfig.openai.apiKey;
const OPENAI_BASE_URL = appConfig.openai.baseUrl;
const omConfig = getObservationalMemoryConfig();
const SUPPRESSED_STDERR_PREFIX = "Upstream LLM API error from";
const SERVER_IDLE_TIMEOUT_SECONDS = Math.max(30, Math.ceil(appConfig.server.replyTimeoutMs / 1000) + 30);
const taskRegistry = new TaskRegistry();

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
    (req.workspace === undefined || typeof req.workspace === "string")
  );
}

type WorkspaceResolution = {
  workspacePath: string;
  workspaceMode: "default" | "path";
};

type StatusPayload = {
  ok: true;
  provider: string;
  model: string;
  protocolVersion: string;
  capabilities: string;
  permissions: string;
  service: string;
  memory: string;
  observational_memory: string;
};

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

async function buildStatusPayload(): Promise<StatusPayload> {
  const model = appConfig.model;
  const providerConfig = {
    openaiApiKey: OPENAI_API_KEY,
    openaiBaseUrl: OPENAI_BASE_URL,
    anthropicApiKey: appConfig.anthropic.apiKey,
    googleApiKey: appConfig.google.apiKey,
  };
  const modelProvider = providerFromModel(model);
  const providerReady = isProviderAvailable({ provider: modelProvider, ...providerConfig });
  const provider = providerReady
    ? modelProvider === "openai"
      ? resolveProvider(OPENAI_API_KEY, OPENAI_BASE_URL)
      : modelProvider
    : "mock";
  const memoryContextCount = (await getMemoryContextEntries()).length;
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
  };
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
      shouldYield: handlers.shouldYield,
      onEvent: (event) => {
        if (handlers.isCancelled?.()) return;
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

type RpcConnectionState = {
  authed: boolean;
  activeChats: Map<string, ActiveRpcChatState>;
  runningChatId: string | null;
  queue: QueuedRpcChat[];
};

type ParsedRpcEnvelope = {
  id: string | null;
  message: z.infer<typeof rpcClientMessageSchema> | null;
};

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
        taskRegistry.upsert(taskId, { state: "cancelled", summary: "Connection closed before completion." });
        log.info("rpc task cancelled on disconnect", { task_id: taskId, state: "running" });
      }
      for (const item of ws.data.queue) {
        item.state.aborted = true;
        taskRegistry.upsert(item.id, { state: "cancelled", summary: "Connection closed while queued." });
        log.info("rpc task cancelled on disconnect", { task_id: item.id, state: "queued" });
      }
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
        taskRegistry.upsert(chatId, { state: "running" });
        log.info("rpc task started", {
          task_id: chatId,
          session_id: request.sessionId ?? null,
          queued_task_count: ws.data.queue.length,
        });
        sendForId(chatId, { type: "chat.started" });
        void runChatRequest(request, {
          path: "/v1/rpc",
          method: "WS",
          taskId: chatId,
          isCancelled: () => state.aborted,
          shouldYield: () => ws.data.queue.length > 0,
          onEvent: (event) => sendForId(chatId, { type: "chat.event", event }),
          onDone: (reply) => {
            taskRegistry.upsert(chatId, {
              state: "completed",
              summary: typeof reply.output === "string" ? reply.output.slice(0, 240) : undefined,
            });
            sendForId(chatId, { type: "chat.done", reply });
          },
          onError: (payload) => {
            taskRegistry.upsert(chatId, { state: "failed", summary: payload.error });
            sendForId(chatId, { type: "chat.error", ...payload });
          },
        }).finally(() => {
          ws.data.activeChats.delete(chatId);
          if (ws.data.runningChatId === chatId) ws.data.runningChatId = null;
          const dequeue = dequeueNextQueuedChat(ws.data.queue);
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

      if (message.type === "status.get") {
        send({ type: "status.result", status: await buildStatusPayload() });
        return;
      }

      if (message.type === "permissions.set") {
        const mode = message.payload.mode;
        setPermissionMode(mode);
        send({ type: "permissions.result", permissionMode: appConfig.agent.permissions.mode });
        return;
      }

      if (message.type === "chat.start") {
        if (ws.data.activeChats.has(message.id) || ws.data.queue.some((item) => item.id === message.id)) {
          send({ type: "error", error: `Chat request already running for id: ${message.id}` });
          return;
        }
        const request = message.payload.request;
        if (!isChatRequest(request)) return send({ type: "error", error: "Invalid request shape" });
        const state: ActiveRpcChatState = { aborted: false };
        taskRegistry.upsert(message.id, { state: "running" });
        log.info("rpc task accepted", {
          task_id: message.id,
          session_id: request.sessionId ?? null,
          queued_task_count: ws.data.queue.length,
          has_running_task: Boolean(ws.data.runningChatId),
        });
        send({ type: "chat.accepted" });
        if (ws.data.runningChatId) {
          ws.data.queue.push({ id: message.id, request, state });
          log.info("rpc task queued", {
            task_id: message.id,
            queue_position: ws.data.queue.length,
            running_task_id: ws.data.runningChatId,
          });
          send({ type: "chat.queued", position: ws.data.queue.length });
          return;
        }
        startChat(message.id, request, state);
        return;
      }

      if (message.type === "chat.abort") {
        const requestId = message.payload.requestId;
        const activeState = ws.data.activeChats.get(requestId);
        if (activeState) {
          activeState.aborted = true;
          taskRegistry.upsert(requestId, { state: "cancelled", summary: "Cancelled by client request." });
          log.info("rpc task abort acknowledged", { task_id: requestId, state: "running" });
          send({ type: "chat.abort.result", requestId, aborted: true });
          return;
        }
        const queueResult = removeQueuedChatById(ws.data.queue, requestId);
        if (queueResult.removed) {
          taskRegistry.upsert(requestId, { state: "cancelled", summary: "Cancelled while queued." });
          log.info("rpc task abort acknowledged", { task_id: requestId, state: "queued" });
          for (const update of queueResult.updates) {
            sendForId(update.id, { type: "chat.queued", position: update.position });
            log.info("rpc task reindexed", { task_id: update.id, queue_position: update.position });
          }
          send({ type: "chat.abort.result", requestId, aborted: true });
          return;
        }
        log.info("rpc task abort ignored", { task_id: requestId });
        send({ type: "chat.abort.result", requestId, aborted: false });
        return;
      }

      if (message.type === "task.status") {
        send({ type: "task.status.result", task: taskRegistry.get(message.payload.taskId) });
        return;
      }

      send({ type: "error", error: "Unsupported RPC method" });
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
