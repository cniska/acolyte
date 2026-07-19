import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCredentials } from "./agent-model";
import { syncAgentsMdToProjectMemory } from "./agents-memory-sync";
import type { ChatRequest } from "./api";
import { readResolvedConfigSync } from "./config";
import { createDebugLogger } from "./debug-flags";
import { createStreamError, errorIdSchema, parseError } from "./error-handling";
import { field } from "./field";
import { runLifecycle } from "./lifecycle";
import { VERBOSE_ONLY_EVENTS } from "./lifecycle-constants";
import { errorToLogFields, log } from "./log";
import { ensureSubscriptionModelsLoaded, isOpenAiSubscriptionModel } from "./openai-subscription-models";
import { loadProjectRulesPrompt } from "./project-rules";
import { isProviderAvailable, providerFromModel } from "./provider-config";
import type { Provider } from "./provider-contract";
import { parseResourceId, projectResourceIdFromWorkspace } from "./resource-id";
import type { RunChatHandlers, StreamErrorPayload } from "./server-contract";
import { createId } from "./short-id";
import { isActiveSkillsPayload } from "./skill-contract";
import { loadSkills } from "./skill-ops";
import { loadSoulPrompt } from "./soul";
import { getDefaultTraceStore, type TraceStore } from "./trace-store";

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

/** Outcome of trying to persist one trace event — the signal for the self-check. */
export type TraceSinkHealth = "written" | "store-unavailable" | "write-failed";

export function logLifecycleDebugEntry(params: {
  requestId: string;
  taskId?: string;
  sessionId?: string;
  event: string;
  sequence: number;
  eventTs: string;
  fields?: Record<string, unknown>;
  logInfo?: (message: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;
  logDebug?: (message: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;
  traceStore?: TraceStore | null;
}): TraceSinkHealth {
  const logFn = VERBOSE_ONLY_EVENTS.has(params.event) ? (params.logDebug ?? log.debug) : (params.logInfo ?? log.info);
  const logFields = toLogFieldMap(params.fields);
  logFn("agent debug", {
    request_id: params.requestId,
    task_id: params.taskId ?? null,
    session_id: params.sessionId ?? null,
    event: params.event,
    sequence: params.sequence,
    event_ts: params.eventTs,
    ...logFields,
  });

  // Store acquisition can throw (createTraceStore: mkdir/open/migrate) — guard it here
  // so a trace-DB failure never crashes the request it is only meant to observe.
  let store: TraceStore | null;
  try {
    store = params.traceStore !== undefined ? params.traceStore : getDefaultTraceStore();
  } catch {
    return "store-unavailable";
  }
  if (!store) return "store-unavailable";
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
    return "written";
  } catch {
    return "write-failed";
  }
}

type TraceSinkFailure = Exclude<TraceSinkHealth, "written">;

// Once per session per failure kind — not per turn (spam), and not per process (a
// long-lived daemon would then warn only the first session, recreating the blackout).
const reportedTraceSinkFailures = new Set<string>();

const latchKey = (sessionId: string | undefined, kind: TraceSinkFailure): string => `${sessionId ?? "-"}:${kind}`;

/** Test-only: clear the trace-sink notice latch. */
export function resetTraceSinkNoticeLatch(): void {
  reportedTraceSinkFailures.clear();
}

/** Claim the first report for a (session, failure kind); returns false once latched. */
export function claimTraceSinkNotice(sessionId: string | undefined, kind: TraceSinkFailure): boolean {
  const key = latchKey(sessionId, kind);
  if (reportedTraceSinkFailures.has(key)) return false;
  reportedTraceSinkFailures.add(key);
  return true;
}

/** Trace-sink notice to surface on the summary event, or null if nothing to report / already latched. */
export function maybeTraceSinkNotice(params: {
  event: string;
  sessionId: string | undefined;
  failureKind: TraceSinkFailure | null;
  droppedEvents: number;
}): { type: "notice"; level: "warn"; message: string; source: string } | null {
  if (params.event !== "lifecycle.summary" || !params.failureKind) return null;
  if (!claimTraceSinkNotice(params.sessionId, params.failureKind)) return null;
  return {
    type: "notice",
    level: "warn",
    message: traceSinkNoticeMessage(params.failureKind, params.droppedEvents),
    source: "trace-store",
  };
}

export function traceSinkNoticeMessage(kind: TraceSinkFailure, droppedEvents: number): string {
  const reason = kind === "store-unavailable" ? "the trace database could not be opened" : "writes are failing";
  const events = droppedEvents === 1 ? "1 diagnostic event was" : `${droppedEvents} diagnostic events were`;
  return `Trace logging is off for this session — ${reason}, so ${events} not recorded.`;
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
  return (
    typeof req.message === "string" &&
    typeof req.model === "string" &&
    Array.isArray(req.history) &&
    (req.sessionId === undefined || typeof req.sessionId === "string") &&
    (req.resourceId === undefined || typeof req.resourceId === "string") &&
    (req.activeSkills === undefined || isActiveSkillsPayload(req.activeSkills)) &&
    (req.suggestions === undefined || Array.isArray(req.suggestions)) &&
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
  return "Set OPENAI_API_KEY, or connect a subscription with: acolyte auth openai.";
}

export async function runChatRequest(chatRequest: ChatRequest, handlers: RunChatHandlers): Promise<void> {
  const requestId = nextErrorId();
  const startedAt = Date.now();
  const modelProvider = providerFromModel(chatRequest.model);
  const providerCredentials = defaultCredentials();
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

  const modelId = bareModelId(chatRequest.model);
  const openaiCreds = providerCredentials.openai;
  if (modelProvider === "openai" && openaiCreds?.oauth) {
    await ensureSubscriptionModelsLoaded(globalThis.fetch);
  }
  if (modelProvider === "openai" && openaiCreds?.oauth && !openaiCreds.apiKey && !isOpenAiSubscriptionModel(modelId)) {
    const payload = streamErrorPayload(
      new Error(
        `Model "${chatRequest.model}" is not available on your OpenAI subscription. Set OPENAI_API_KEY to use other OpenAI models.`,
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
    const soulPrompt = loadSoulPrompt();
    const projectRulesPrompt = config.features.syncAgents
      ? "Project rules are available via project memory. Use memory-search to retrieve them when needed."
      : loadProjectRulesPrompt(workspaceResolution.workspacePath);
    let traceSinkFailureKind: Exclude<TraceSinkHealth, "written"> | null = null;
    let traceSinkDropped = 0;
    const reply = await runLifecycle({
      request: lifecycleRequest,
      soulPrompt,
      projectRulesPrompt,
      workspace: workspaceResolution.workspacePath,
      features: config.features,
      reasoning: config.reasoning,
      temperature: config.temperature,
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
        const health = logLifecycleDebugEntry({
          requestId,
          taskId: handlers.taskId,
          sessionId: chatRequest.sessionId,
          event: entry.event,
          sequence: entry.sequence,
          eventTs: entry.ts,
          fields: entry.fields,
        });
        if (health !== "written") {
          traceSinkFailureKind = health;
          traceSinkDropped += 1;
        }
        const notice = maybeTraceSinkNotice({
          event: entry.event,
          sessionId: chatRequest.sessionId,
          failureKind: traceSinkFailureKind,
          droppedEvents: traceSinkDropped,
        });
        if (notice) {
          try {
            log.warn("trace sink dark", {
              event: "trace.sink.dark",
              kind: traceSinkFailureKind,
              dropped_events: traceSinkDropped,
              request_id: requestId,
            });
            if (!runControl?.isCancelled()) handlers.onEvent(notice);
          } catch {
            // A failed notice must not crash the request the sink only observes.
          }
        }
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
