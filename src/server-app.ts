import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent } from "./agent";
import { type ChatRequest, verifyScopeSchema } from "./api";
import { appConfig } from "./app-config";
import { createDebugLogger } from "./debug-flags";
import { buildStreamErrorDetail } from "./error-handling";
import { errorToLogFields, log } from "./log";
import { mastraStorage, mastraStorageMode } from "./mastra-storage";
import { getObservationalMemoryConfig } from "./memory-config";
import { formatServerCapabilities, PROTOCOL_VERSION } from "./protocol";
import { formatModel, isProviderAvailable, providerFromModel, resolveProvider } from "./provider-config";
import type { RunChatHandlers, StatusPayload, StreamErrorPayload } from "./server-contract";
import { createServerFetchHandler } from "./server-http";
import { createRpcWebsocketHandlers, getRpcQueuedTaskCount, type RpcConnectionState } from "./server-rpc";
import { createId } from "./short-id";
import { createSoulPrompt, getMemoryContextEntries } from "./soul";
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
const taskRegistry = new TaskRegistry();
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

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function nextErrorId(): string {
  return `err_${createId()}`;
}

function streamErrorPayload(error: unknown): StreamErrorPayload {
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
    (req.verifyScope === undefined || verifyScopeSchema.safeParse(req.verifyScope).success) &&
    (req.workspace === undefined || typeof req.workspace === "string")
  );
}

type WorkspaceResolution = {
  workspacePath: string;
  workspaceMode: "default" | "path";
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
    rpc_queue_length: getRpcQueuedTaskCount(),
  };
}

function providerConfigurationHint(provider: "openai" | "openai-compatible" | "anthropic" | "gemini"): string {
  if (provider === "openai-compatible") return "Configure openaiBaseUrl to your compatible endpoint.";
  if (provider === "anthropic") return "Set ANTHROPIC_API_KEY.";
  if (provider === "gemini") return "Set GOOGLE_API_KEY.";
  return "Set OPENAI_API_KEY (or use openai-compatible/<model> with a local endpoint).";
}

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
    buildStatusPayload: async () => await buildStatusPayload(),
    isChatRequest,
    runChatRequest,
    taskRegistry,
    transitionTaskState,
  });

  let server: Bun.Server<RpcConnectionState>;
  const fetchHandler = createServerFetchHandler({
    buildStatusPayload: async () => await buildStatusPayload(),
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
