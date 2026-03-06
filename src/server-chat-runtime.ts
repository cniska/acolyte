import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { type ChatRequest, verifyScopeSchema } from "./api";
import { appConfig } from "./app-config";
import { createDebugLogger } from "./debug-flags";
import { buildStreamErrorDetail, errorIdSchema } from "./error-handling";
import { runLifecycle } from "./lifecycle";
import { errorToLogFields, log } from "./log";
import { isProviderAvailable, providerFromModel } from "./provider-config";
import type { Provider } from "./provider-contract";
import { parseResourceId, projectResourceIdFromWorkspace } from "./resource-id";
import type { RunChatHandlers, StreamErrorPayload } from "./server-contract";
import { createId } from "./short-id";
import { createSoulPrompt } from "./soul";
import { extractToolErrorCode } from "./tool-error-codes";

const OPENAI_API_KEY = appConfig.openai.apiKey;
const OPENAI_BASE_URL = appConfig.openai.baseUrl;

const debug = createDebugLogger({
  scope: "server",
  sink: (line) => log.debug(line),
});

type WorkspaceResolution = {
  workspacePath: string;
  workspaceMode: "default" | "path";
};

function toLogFieldMap(fields?: Record<string, unknown>): Record<string, string | number | boolean | null | undefined> {
  if (!fields) return {};
  const out: Record<string, string | number | boolean | null | undefined> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    try {
      out[key] = JSON.stringify(value);
    } catch {
      out[key] = "[unserializable]";
    }
  }
  return out;
}

export function buildMemoryQualityWarningLogFields(params: {
  requestId: string;
  taskId?: string;
  sessionId?: string;
  event: string;
  eventTs: string;
  fields?: Record<string, string | number | boolean | null | undefined>;
}): Record<string, string | number | boolean | null | undefined> | null {
  if (params.event !== "lifecycle.memory.quality_warning") return null;
  return {
    request_id: params.requestId,
    task_id: params.taskId ?? null,
    session_id: params.sessionId ?? null,
    event: params.event,
    event_ts: params.eventTs,
    warning: params.fields?.warning ?? null,
    malformed_reject_streak: params.fields?.malformed_reject_streak ?? 0,
    malformed_tagged_facts: params.fields?.malformed_tagged_facts ?? 0,
    queue_key: params.fields?.queue_key ?? null,
  };
}

export function logLifecycleDebugEntry(params: {
  requestId: string;
  taskId?: string;
  sessionId?: string;
  event: string;
  sequence: number;
  phaseAttempt: number;
  eventTs: string;
  fields?: Record<string, unknown>;
  logInfo?: (message: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;
}): void {
  const logInfo = params.logInfo ?? log.info;
  const logFields = toLogFieldMap(params.fields);
  logInfo("agent debug", {
    request_id: params.requestId,
    task_id: params.taskId ?? null,
    session_id: params.sessionId ?? null,
    event: params.event,
    sequence: params.sequence,
    phase_attempt: params.phaseAttempt,
    event_ts: params.eventTs,
    ...logFields,
  });
  const memoryQualityWarning = buildMemoryQualityWarningLogFields({
    requestId: params.requestId,
    taskId: params.taskId,
    sessionId: params.sessionId,
    event: params.event,
    eventTs: params.eventTs,
    fields: logFields,
  });
  if (memoryQualityWarning) logInfo("memory quality warning", memoryQualityWarning);
}

function nextErrorId(): string {
  return errorIdSchema.parse(`err_${createId()}`);
}

export function streamErrorPayload(error: unknown): StreamErrorPayload {
  const errorId = nextErrorId();
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
    errorId,
    errorCode,
    errorDetail,
  };
}

export function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;

  const req = value as Partial<ChatRequest>;
  const modeModelsValid =
    req.modeModels === undefined ||
    (typeof req.modeModels === "object" &&
      req.modeModels !== null &&
      Object.entries(req.modeModels as Record<string, unknown>).every(
        ([mode, model]) =>
          (mode === "plan" || mode === "work" || mode === "verify" || mode === "chat") && typeof model === "string",
      ));
  return (
    typeof req.message === "string" &&
    typeof req.model === "string" &&
    Array.isArray(req.history) &&
    modeModelsValid &&
    (req.sessionId === undefined || typeof req.sessionId === "string") &&
    (req.resourceId === undefined || typeof req.resourceId === "string") &&
    (req.useMemory === undefined || typeof req.useMemory === "boolean") &&
    (req.verifyScope === undefined || verifyScopeSchema.safeParse(req.verifyScope).success) &&
    (req.workspace === undefined || typeof req.workspace === "string")
  );
}

function resolveWorkspacePath(request: Pick<ChatRequest, "workspace">): WorkspaceResolution {
  if (!request.workspace) return { workspacePath: resolve(process.cwd()), workspaceMode: "default" };
  const resolved = resolve(request.workspace);
  if (!existsSync(resolved)) throw new Error(`Workspace path does not exist: ${resolved}`);
  if (!statSync(resolved).isDirectory()) throw new Error(`Workspace path is not a directory: ${resolved}`);
  return { workspacePath: resolved, workspaceMode: "path" };
}

function providerConfigurationHint(provider: Provider): string {
  if (provider === "anthropic") return "Set ANTHROPIC_API_KEY.";
  if (provider === "gemini") return "Set GOOGLE_API_KEY.";
  return "Set OPENAI_API_KEY (or use openai-compatible/<model> with a local endpoint).";
}

export async function runChatRequest(chatRequest: ChatRequest, handlers: RunChatHandlers): Promise<void> {
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

  const providedResourceId = parseResourceId(chatRequest.resourceId);
  if (chatRequest.resourceId && !providedResourceId) {
    const payload = streamErrorPayload(
      new Error(`Invalid resourceId "${chatRequest.resourceId}". Expected user_* or proj_*.`),
    );
    handlers.onError(payload);
    return;
  }
  const canonicalResourceId = providedResourceId ?? projectResourceIdFromWorkspace(workspaceResolution.workspacePath);
  const lifecycleRequest: ChatRequest = { ...chatRequest, resourceId: canonicalResourceId };

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
    const soulPrompt = await createSoulPrompt({
      sessionId: chatRequest.sessionId,
      resourceId: canonicalResourceId,
      workspace: workspaceResolution.workspacePath,
      useMemory: chatRequest.useMemory !== false,
      onDebug: (event, fields) => {
        log.info("agent debug", {
          request_id: requestId,
          task_id: handlers.taskId ?? null,
          session_id: chatRequest.sessionId ?? null,
          event,
          sequence: 0,
          phase_attempt: 0,
          event_ts: new Date().toISOString(),
          ...(fields ?? {}),
        });
      },
    });
    const reply = await runLifecycle({
      request: lifecycleRequest,
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
        logLifecycleDebugEntry({
          requestId,
          taskId: handlers.taskId,
          sessionId: chatRequest.sessionId,
          event: entry.event,
          sequence: entry.sequence,
          phaseAttempt: entry.phaseAttempt,
          eventTs: entry.ts,
          fields: entry.fields,
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
