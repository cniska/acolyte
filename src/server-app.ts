import type { z } from "zod";
import { appConfig } from "./app-config";
import { buildStreamErrorDetail } from "./error-handling";
import { mapQuotaErrorMessage } from "./error-messages";
import { domainIdSchema } from "./id-contract";
import { errorToLogFields, log } from "./log";
import { mastraStorage, mastraStorageMode } from "./mastra-storage";
import { getObservationalMemoryConfig } from "./memory-config";
import { formatServerCapabilities, PROTOCOL_VERSION } from "./protocol";
import { formatModel } from "./provider-config";
import type { Provider } from "./provider-contract";
import { isChatRequest, runChatRequest } from "./server-chat-runtime";
import type { StatusPayload } from "./server-contract";
import { createServerFetchHandler } from "./server-http";
import { createRpcWebsocketHandlers, getRpcQueuedTaskCount, type RpcConnectionState } from "./server-rpc";
import { createId } from "./short-id";
import { getMemoryContextEntries } from "./soul";
import type { TaskId, TaskState, TaskTransitionReason } from "./task-contract";
import { TaskRegistry } from "./task-registry";

const PORT = appConfig.server.port;
const API_KEY = appConfig.server.apiKey;
const OPENAI_API_KEY = appConfig.openai.apiKey;
const omConfig = getObservationalMemoryConfig();
const SUPPRESSED_STDERR_PREFIX = "Upstream LLM API error from";
const SERVER_IDLE_TIMEOUT_SECONDS = Math.max(30, Math.ceil(appConfig.server.replyTimeoutMs / 1000) + 30);
const taskRegistry = new TaskRegistry();
const errorIdSchema = domainIdSchema("err");
type ErrorId = z.infer<typeof errorIdSchema>;

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]): void => {
  const first = args[0];
  if (typeof first === "string" && first.includes(SUPPRESSED_STDERR_PREFIX)) return;
  originalConsoleError(...args);
};

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const publicMessage = mapQuotaErrorMessage(errorMessage);
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
  if (appConfig.google.apiKey) providers.push("gemini");
  const model = appConfig.model;
  const chatModel = appConfig.models.chat?.trim();
  const planModel = appConfig.models.plan?.trim();
  const workModel = appConfig.models.work?.trim();
  const verifyModel = appConfig.models.verify?.trim();
  const memoryContextCount = (await getMemoryContextEntries()).length;
  const taskSummary = taskRegistry.summary();
  return {
    ok: true,
    providers,
    model: formatModel(model),
    ...(planModel ? { "model.plan": formatModel(planModel) } : {}),
    ...(workModel ? { "model.work": formatModel(workModel) } : {}),
    ...(verifyModel ? { "model.verify": formatModel(verifyModel) } : {}),
    ...(chatModel ? { "model.chat": formatModel(chatModel) } : {}),
    protocol_version: PROTOCOL_VERSION,
    capabilities: formatServerCapabilities(),
    permissions: appConfig.agent.permissions.mode,
    service: `http://localhost:${PORT}`,
    memory: memoryContextCount > 0 ? `${mastraStorageMode} (${memoryContextCount} entries)` : mastraStorageMode,
    observational_memory: `enabled (${omConfig.scope})`,
    tasks_total: taskSummary.total,
    tasks_running: taskSummary.running,
    tasks_detached: taskSummary.detached,
    rpc_queue_length: getRpcQueuedTaskCount(),
  };
}

export async function startServer(): Promise<void> {
  try {
    await mastraStorage.init();
  } catch (error) {
    log.error("failed to initialize Mastra storage", {
      ...errorToLogFields(error),
    });
    process.exit(1);
  }

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
    resolveResourceId,
    runChatRequest,
    serverError,
    upgradeToRpc: (req) =>
      server.upgrade(req, { data: { authed: true, activeChats: new Map(), runningChatId: null, queue: [] } }),
  });

  server = Bun.serve<RpcConnectionState>({
    port: PORT,
    idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
    fetch: fetchHandler,
    websocket: rpcWebsocketHandlers,
  });

  process.on("uncaughtException", (error) => {
    log.error("uncaught exception", errorToLogFields(error));
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection", errorToLogFields(reason instanceof Error ? reason : new Error(String(reason))));
  });

  log.info("Acolyte server listening", { url: `http://localhost:${server.port}` });
}
