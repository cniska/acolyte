import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { syncAgentsMdToProjectMemory } from "./agents-memory-sync";
import type { ChatRequest } from "./api";
import { appConfig } from "./app-config";
import { readResolvedConfigSync } from "./config";
import { createDebugLogger } from "./debug-flags";
import { createStreamError, errorIdSchema, parseError } from "./error-handling";
import { field } from "./field";
import { runLifecycle } from "./lifecycle";
import { errorToLogFields, log } from "./log";
import { isProviderAvailable, providerFromModel } from "./provider-config";
import type { Provider } from "./provider-contract";
import { parseResourceId, projectResourceIdFromWorkspace } from "./resource-id";
import type { RunChatHandlers, StreamErrorPayload } from "./server-contract";
import { createId } from "./short-id";
import { loadSkills } from "./skills";
import { createSoulPrompt } from "./soul";
import { getDefaultTraceStore, type TraceStore } from "./trace-store";

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

export function logLifecycleDebugEntry(params: {
  requestId: string;
  taskId?: string;
  sessionId?: string;
  event: string;
  sequence: number;
  eventTs: string;
  fields?: Record<string, unknown>;
  logInfo?: (message: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;
  traceStore?: TraceStore | null;
}): void {
  const logInfo = params.logInfo ?? log.info;
  const logFields = toLogFieldMap(params.fields);
  logInfo("agent debug", {
    request_id: params.requestId,
    task_id: params.taskId ?? null,
    session_id: params.sessionId ?? null,
    event: params.event,
    sequence: params.sequence,
    event_ts: params.eventTs,
    ...logFields,
  });

  const store = params.traceStore !== undefined ? params.traceStore : getDefaultTraceStore();
  if (store) {
    try {
      store.write({
        timestamp: params.eventTs,
        taskId: params.taskId,
        requestId: params.requestId,
        sessionId: params.sessionId,
        event: params.event,
        sequence: params.sequence,
        fields: logFields,
      });
    } catch {
      // Don't let trace store failures affect the hot path.
    }
  }
}

function nextErrorId(): string {
  return errorIdSchema.parse(`err_${createId()}`);
}

export function streamErrorPayload(error: unknown): StreamErrorPayload {
  const errorId = nextErrorId();
  const parsed = parseError(error);
  const errorMessage = parsed.ok ? parsed.value.message : error instanceof Error ? error.message : "Unknown error";
  const { errorCode, error: streamError } = createStreamError({
    message: errorMessage,
    code: parsed.ok ? parsed.value.code : undefined,
    kind: parsed.ok ? parsed.value.kind : undefined,
    source: "server",
  });
  return {
    errorMessage,
    errorId,
    errorCode,
    error: streamError,
  };
}

export function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;

  const req = value as Partial<ChatRequest>;
  const validActiveSkills =
    req.activeSkills === undefined ||
    (Array.isArray(req.activeSkills) &&
      req.activeSkills.every(
        (skill) =>
          skill &&
          typeof skill === "object" &&
          typeof (skill as { name?: unknown }).name === "string" &&
          typeof (skill as { instructions?: unknown }).instructions === "string",
      ));
  return (
    typeof req.message === "string" &&
    typeof req.model === "string" &&
    Array.isArray(req.history) &&
    (req.sessionId === undefined || typeof req.sessionId === "string") &&
    (req.resourceId === undefined || typeof req.resourceId === "string") &&
    validActiveSkills &&
    (req.useMemory === undefined || typeof req.useMemory === "boolean") &&
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
  if (provider === "google") return "Set GOOGLE_API_KEY.";
  if (provider === "vercel") return "Set AI_GATEWAY_API_KEY.";
  return "Set OPENAI_API_KEY (or use openai-compatible/<model> with a local endpoint).";
}

export async function runChatRequest(chatRequest: ChatRequest, handlers: RunChatHandlers): Promise<void> {
  const requestId = nextErrorId();
  const startedAt = Date.now();
  const modelProvider = providerFromModel(chatRequest.model);
  const providerCredentials: Record<string, { apiKey?: string; baseUrl?: string }> = {
    openai: { apiKey: OPENAI_API_KEY, baseUrl: OPENAI_BASE_URL },
    anthropic: appConfig.anthropic,
    google: appConfig.google,
    vercel: appConfig.vercel,
  };
  const providerReady = isProviderAvailable(modelProvider, providerCredentials[modelProvider] ?? {});
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
    event: "chat.request.started",
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

  const runControl = handlers.runControl;
  try {
    await loadSkills(workspaceResolution.workspacePath);
    const config = readResolvedConfigSync({ cwd: workspaceResolution.workspacePath });
    if (config.features.syncAgents) {
      await syncAgentsMdToProjectMemory({ workspace: workspaceResolution.workspacePath });
    }
    const soulPrompt = await createSoulPrompt({
      cwd: workspaceResolution.workspacePath,
      includeAgents: !config.features.syncAgents,
      agentsHint: config.features.syncAgents ? "memory" : "none",
    });
    const reply = await runLifecycle({
      request: lifecycleRequest,
      soulPrompt,
      workspace: workspaceResolution.workspacePath,
      features: config.features,
      taskId: handlers.taskId,
      runControl,
      onEvent: (event) => {
        if (runControl?.isCancelled()) return;
        if (field(event, "type") === "tool-output")
          debug.log("tool-stream-forward", {
            task_id: handlers.taskId ?? null,
            type: "tool-output",
            tool: field(event, "toolName"),
            tool_call_id: field(event, "toolCallId"),
          });
        handlers.onEvent(event as Record<string, unknown>);
      },
      onMemoryCommit: handlers.onMemoryCommit,
      onDebug: (entry) => {
        logLifecycleDebugEntry({
          requestId,
          taskId: handlers.taskId,
          sessionId: chatRequest.sessionId,
          event: entry.event,
          sequence: entry.sequence,
          eventTs: entry.ts,
          fields: entry.fields,
        });
      },
    });
    if (runControl?.isCancelled()) {
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
      event: "chat.request.completed",
      request_id: requestId,
      task_id: handlers.taskId ?? null,
      session_id: chatRequest.sessionId ?? null,
      model: reply.model,
      duration_ms: durationMs,
      model_calls: reply.modelCalls ?? null,
      tool_count: reply.toolCalls?.length ?? 0,
      tools: reply.toolCalls?.join(",") ?? "",
      input_tokens: reply.usage?.inputTokens ?? null,
      output_tokens: reply.usage?.outputTokens ?? null,
      stream: true,
      transport_path: handlers.path,
    });
    handlers.onDone(reply);
  } catch (error) {
    if (runControl?.isCancelled()) return;
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
