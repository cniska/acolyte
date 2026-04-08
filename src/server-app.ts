import crypto from "node:crypto";
import { appConfig } from "./app-config";
import { decodeTokenSubject } from "./credentials";
import { createStreamError, type ErrorId, errorIdSchema } from "./error-handling";
import { mapQuotaErrorMessage } from "./error-messages";
import { t } from "./i18n";
import { errorToLogFields, log } from "./log";
import { formatServerCapabilities, PROTOCOL_VERSION } from "./protocol";
import type { Provider } from "./provider-contract";
import { collectResourceDiagnostics } from "./resource-diagnostics";
import { isChatRequest, runChatRequest } from "./server-chat-runtime";
import type { StatusPayload } from "./server-contract";
import { createServerFetchHandler, json } from "./server-http";
import { createRpcWebsocketHandlers, getRpcQueuedTaskCount, type RpcConnectionState } from "./server-rpc";
import { createId } from "./short-id";
import type { TaskId, TaskState, TaskTransitionReason } from "./task-contract";
import { TaskRegistry } from "./task-registry";
import { closeDefaultTraceStore } from "./trace-store";

const PORT = process.env.PORT ? Number(process.env.PORT) : appConfig.server.port;
const HOST = "127.0.0.1";
const API_KEY = appConfig.server.apiKey;
const OPENAI_API_KEY = appConfig.openai.apiKey;
const SUPPRESSED_STDERR_PREFIX = "Upstream LLM API error from";
const SERVER_IDLE_TIMEOUT_SECONDS = Math.max(30, Math.ceil(appConfig.server.replyTimeoutMs / 1000) + 30);
const taskRegistry = new TaskRegistry();

function nextErrorId(): ErrorId {
  return errorIdSchema.parse(`err_${createId()}`);
}

function serverError(
  message: string,
  error: unknown,
  details: Record<string, string | number | boolean | null | undefined>,
  status = 500,
): Response {
  const errorId = nextErrorId();
  const errorMessage = error instanceof Error ? error.message : t("unknown_error");
  const publicMessage = mapQuotaErrorMessage(errorMessage);
  const { errorCode, error: streamError } = createStreamError({
    message: publicMessage,
    source: "server",
  });
  log.error(message, {
    error_id: errorId,
    ...details,
    ...errorToLogFields(error),
  });
  return json({ errorMessage: publicMessage, errorId, errorCode, error: streamError }, status);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

function hasValidAuth(req: Request): boolean {
  if (!API_KEY) return true;

  const auth = req.headers.get("authorization");
  if (auth && safeEqual(auth, `Bearer ${API_KEY}`)) return true;

  const protocol = req.headers.get("sec-websocket-protocol") ?? "";
  for (const proto of protocol.split(",")) {
    const trimmed = proto.trim();
    if (trimmed.startsWith("bearer.") && safeEqual(trimmed.slice(7), API_KEY)) return true;
  }

  return false;
}

function transitionTaskState(
  taskId: TaskId,
  patch: { state?: TaskState; summary?: string },
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
    event: "task.state_updated",
    task_id: taskId,
    from_state: previous?.state ?? null,
    to_state: next.state,
    reason: meta?.reason ?? null,
    transport: meta?.transport ?? null,
  });
}

async function createStatusPayload(): Promise<StatusPayload> {
  const providers: Provider[] = [];
  if (OPENAI_API_KEY) providers.push("openai");
  if (appConfig.anthropic.apiKey) providers.push("anthropic");
  if (appConfig.google.apiKey) providers.push("google");
  const model = appConfig.model;
  const taskSummary = taskRegistry.summary();
  const resourceDiagnostics = collectResourceDiagnostics();
  const cloudUser = appConfig.cloudToken ? decodeTokenSubject(appConfig.cloudToken) : undefined;
  return {
    ok: true,
    providers,
    model,
    protocol_version: PROTOCOL_VERSION,
    capabilities: formatServerCapabilities(),
    service: `http://localhost:${PORT}`,
    tasks_total: taskSummary.total,
    tasks_running: taskSummary.running,
    tasks_detached: taskSummary.detached,
    rpc_queue_length: getRpcQueuedTaskCount(),
    ...resourceDiagnostics,
    ...(appConfig.features.cloudSync && cloudUser ? { cloud_user: cloudUser } : {}),
    ...(appConfig.features.cloudSync && appConfig.cloudUrl ? { cloud_url: appConfig.cloudUrl } : {}),
  };
}

export async function startServer(): Promise<void> {
  // Suppress noisy upstream LLM SDK errors that are already handled at the application layer.
  // Scoped here so it only applies while the server is running.
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    const first = args[0];
    if (typeof first === "string" && first.includes(SUPPRESSED_STDERR_PREFIX)) return;
    originalConsoleError(...args);
  };

  const rpcWebsocketHandlers = createRpcWebsocketHandlers({
    createStatusPayload,
    isChatRequest,
    runChatRequest,
    taskRegistry,
    transitionTaskState,
  });

  let server: Bun.Server<RpcConnectionState>;
  const fetchHandler = createServerFetchHandler({
    createStatusPayload,
    hasValidAuth,
    isChatRequest,
    runChatRequest,
    serverError,
    shutdownServer: () => {
      setTimeout(() => {
        try {
          closeDefaultTraceStore();
          server.stop(true);
        } catch {
          // Best effort shutdown.
        }
      }, 0);
    },
    upgradeToRpc: (req) =>
      server.upgrade(req, { data: { authed: true, activeChats: new Map(), runningChatId: null, queue: [] } }),
  });

  try {
    server = Bun.serve<RpcConnectionState>({
      port: PORT,
      hostname: HOST,
      idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
      fetch: fetchHandler,
      websocket: rpcWebsocketHandlers,
    });
  } catch (error) {
    log.error("server failed to start", errorToLogFields(error instanceof Error ? error : new Error(String(error))));
    process.exit(1);
  }

  process.on("uncaughtException", (error) => {
    log.error("uncaught exception", errorToLogFields(error));
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection", errorToLogFields(reason instanceof Error ? reason : new Error(String(reason))));
  });
  process.on("SIGTERM", () => {
    log.info("server shutdown via SIGTERM");
    closeDefaultTraceStore();
    server.stop(true);
  });

  log.info("server listening", { url: `http://${HOST}:${server.port}` });
}
