import type { Agent } from "@mastra/core/agent";
import {
  canonicalToolId,
  createAgentInput,
  createInstructions,
  createSubagentContext,
  estimateTokens,
  finalizeAssistantOutput,
  finalizeReviewOutput,
  resolveRunnableModel,
} from "./agent";
import { createAcolyte } from "./agent-factory";
import { type AgentMode, agentModes, classifyMode, modeForTool } from "./agent-modes";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import type { StreamEvent } from "./client";
import {
  buildStreamErrorDetail,
  categoryFromErrorCode,
  classifyErrorCategory,
  createErrorStats,
  type ErrorCategory,
  type ErrorSource,
  errorCodeFromCategory,
  isEditFileMultiMatchSignal,
  parseErrorInfo,
  type RecoveryAction,
  recoveryActionForError as resolveRecoveryAction,
} from "./error-handling";
import {
  INITIAL_MAX_STEPS,
  MAX_EVALUATOR_CHAIN_REGENERATIONS,
  MAX_REGENERATIONS_PER_EVALUATOR,
  MAX_REGENERATIONS_PER_REQUEST,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
} from "./lifecycle-constants";
import {
  autoVerifier,
  type EvalAction,
  type Evaluator,
  efficiencyEvaluator,
  multiMatchEditEvaluator,
  planDetector,
  timeoutRecovery,
  verifyFailure,
} from "./lifecycle-evaluators";
import type { LifecycleDebugEvent, LifecycleEventName } from "./lifecycle-events";
import { type AcolyteToolset, toolsForAgent } from "./mastra-tools";
import { countLabel } from "./plural";
import type { StreamErrorDetail } from "./stream-error";
import { type ErrorCode, extractToolErrorCode, LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { DISCOVERY_TOOL_SET, READ_TOOL_SET, SEARCH_TOOL_SET, WRITE_TOOL_SET } from "./tool-groups";
import type { SessionContext } from "./tool-guards";

export { autoVerifier, efficiencyEvaluator, multiMatchEditEvaluator, planDetector, timeoutRecovery, verifyFailure };
export type { EvalAction, Evaluator };

export type GenerateResult = {
  text: string;
  toolCalls: unknown[];
};

type ToolOutputEvent = { toolName: string; message: string; toolCallId?: string };
type ToolCallStart = { toolName: string; startedAtMs: number };
type MemoryOptions = { thread: string; resource: string };
type PromptUsage = {
  promptTokens: number;
  promptBudgetTokens: number;
  promptTruncated: boolean;
  includedHistoryMessages: number;
  totalHistoryMessages: number;
};
type StreamChunk = { type?: string; payload?: unknown };
type TextDeltaPayload = { text?: string };
type ToolCallPayload = { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
type ToolResultPayload = { toolCallId?: string; toolName?: string; result?: unknown };
type ToolErrorPayload = { error?: unknown; message?: string; code?: unknown; toolName?: string; toolCallId?: string };
type ModeResolution = { model: string; provider: string };
type PhaseClassifyResult = { classifiedMode: AgentMode; model: string };
type PhasePrepareInput = {
  request: ChatRequest;
  workspace: string | undefined;
  taskId: string | undefined;
  soulPrompt: string;
  classifiedMode: AgentMode;
  model: string;
  debug: RunContext["debug"];
  onToolOutput: (event: ToolOutputEvent) => void;
};
type PhasePrepareResult = {
  session: SessionContext;
  tools: Partial<AcolyteToolset>;
  agentInput: string;
  memoryOptions: MemoryOptions | undefined;
  promptUsage: PromptUsage;
};
type GenerateOptions = { maxSteps: number; timeoutMs: number };
type SavedRegenerationState = {
  result: GenerateResult | undefined;
  lastError: string | undefined;
  lastErrorCode: string | undefined;
  lastErrorCategory: ErrorCategory | undefined;
  lastErrorSource: ErrorSource | undefined;
  lastErrorTool: string | undefined;
};

export type LifecycleInput = {
  request: ChatRequest;
  soulPrompt: string;
  workspace?: string;
  taskId?: string;
  onEvent?: (event: StreamEvent) => void;
  onDebug?: (event: LifecycleDebugEvent) => void;
  shouldYield?: () => boolean;
};

export type RunContext = {
  readonly request: ChatRequest;
  readonly workspace: string | undefined;
  readonly taskId: string | undefined;
  readonly soulPrompt: string;
  readonly emit: (event: StreamEvent) => void;
  readonly debug: (event: LifecycleEventName, fields?: Record<string, unknown>) => void;
  readonly classifiedMode: AgentMode;
  readonly tools: Partial<AcolyteToolset>;
  readonly session: SessionContext;
  readonly agentInput: string;
  readonly memoryOptions?: MemoryOptions;
  readonly promptUsage: PromptUsage;
  model: string;
  agent: Agent;
  agentMode: AgentMode;
  mode: AgentMode;
  observedTools: Set<string>;
  modelCallCount: number;
  generationAttempt: number;
  regenerationCount: number;
  regenerationLimitHit: boolean;
  sawEditFileMultiMatchError: boolean;
  lastError?: string;
  lastErrorCode?: ErrorCode | string;
  lastErrorCategory?: ErrorCategory;
  lastErrorSource?: ErrorSource;
  lastErrorTool?: string;
  errorStats: Record<ErrorCategory, number>;
  result?: GenerateResult;
  nativeIdQueue: Map<string, string[]>;
  toolCallStartedAt: Map<string, ToolCallStart>;
  toolOutputHandler: ((event: ToolOutputEvent) => void) | null;
};

// --- Helpers ---

function formatToolArgs(args: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      out[key] = value.length > 80 ? `${value.slice(0, 79)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function isReviewRequest(text: string): boolean {
  return /\breview\b/i.test(text);
}

function shouldYieldNow(ctx: RunContext, shouldYield?: () => boolean): boolean {
  if (!shouldYield) return false;
  if (!shouldYield()) return false;
  ctx.debug("lifecycle.yield", {
    generation_attempt: ctx.generationAttempt,
    regeneration_count: ctx.regenerationCount,
  });
  if (!ctx.result?.text.trim()) {
    ctx.result = {
      text: "Yielding to a newer pending message.",
      toolCalls: ctx.result?.toolCalls ?? [],
    };
  }
  return true;
}

export function recoveryActionForError(input: { errorCode?: string; unknownErrorCount: number }): RecoveryAction {
  return resolveRecoveryAction(input, MAX_UNKNOWN_ERRORS_PER_REQUEST);
}

function captureError(
  ctx: RunContext,
  message: string,
  meta?: { source?: ErrorSource; tool?: string; code?: string },
): void {
  ctx.lastError = message;
  const derivedCategory = classifyErrorCategory(message);
  const code = meta?.code ?? extractToolErrorCode(message) ?? errorCodeFromCategory(derivedCategory);
  ctx.lastErrorCode = code;
  const category = categoryFromErrorCode(code) ?? derivedCategory;
  ctx.lastErrorCategory = category;
  ctx.lastErrorSource = meta?.source;
  ctx.lastErrorTool = meta?.tool;
  ctx.errorStats[category] += 1;
  if (isEditFileMultiMatchSignal({ code, message })) ctx.sawEditFileMultiMatchError = true;
  ctx.debug("lifecycle.error", {
    source: meta?.source ?? "generate",
    tool: meta?.tool ?? null,
    code: code ?? null,
    category,
    message: message.length > 240 ? `${message.slice(0, 239)}…` : message,
  });
}

function currentErrorDetail(ctx: RunContext): StreamErrorDetail | undefined {
  if (!ctx.lastError) return undefined;
  return buildStreamErrorDetail(
    {
      message: ctx.lastError,
      code: ctx.lastErrorCode,
      source: ctx.lastErrorSource,
      tool: ctx.lastErrorTool,
      unknownErrorCount: ctx.errorStats.other,
    },
    MAX_UNKNOWN_ERRORS_PER_REQUEST,
  ).errorDetail;
}

function guardStatsFromSession(session: SessionContext): { blocked: number; flagSet: number } {
  const value = session.flags.guardStats;
  if (!value || typeof value !== "object") return { blocked: 0, flagSet: 0 };
  const stats = value as { blocked?: unknown; flagSet?: unknown };
  const blocked = typeof stats.blocked === "number" ? stats.blocked : 0;
  const flagSet = typeof stats.flagSet === "number" ? stats.flagSet : 0;
  return { blocked, flagSet };
}

function taskScopedCallLog(session: SessionContext, taskId: string | undefined) {
  if (!taskId) return session.callLog;
  return session.callLog.filter((entry) => entry.taskId === taskId);
}

function emitModeStatus(ctx: RunContext): void {
  ctx.emit({ type: "status", message: `${agentModes[ctx.mode].statusText} (${ctx.model})` });
}

// --- Phase: Classify ---

function resolveModeModelOrThrow(mode: AgentMode, fallbackModel: string): ModeResolution {
  const requestedModel = appConfig.models[mode] ?? fallbackModel;
  const resolved = resolveRunnableModel(requestedModel);
  if (!resolved.available) {
    throw new Error(
      `Provider '${resolved.provider}' is not configured for model '${resolved.model}'. ` +
        "Set the API key in your config or environment, or switch to another model.",
    );
  }
  return { model: resolved.model, provider: resolved.provider };
}

function phaseClassify(request: ChatRequest, debug: RunContext["debug"]): PhaseClassifyResult {
  const classifiedMode = classifyMode(request.message);
  const resolved = resolveModeModelOrThrow(classifiedMode, request.model);
  debug("lifecycle.classify", { mode: classifiedMode, model: resolved.model, provider: resolved.provider });
  return { classifiedMode, model: resolved.model };
}

// --- Phase: Prepare ---

function phasePrepare(input: PhasePrepareInput): PhasePrepareResult {
  const requestInput = createAgentInput(input.request);
  const subagentContext = createSubagentContext(input.request);
  const agentInput = `${subagentContext}\n\n${requestInput.input}`;

  const resourceId = input.request.resourceId?.trim() || appConfig.memory.resourceId;
  const memoryOptions =
    input.request.useMemory && input.request.sessionId
      ? { thread: input.request.sessionId, resource: resourceId }
      : undefined;

  const { tools, session } = toolsForAgent({
    workspace: input.workspace,
    onToolOutput: input.onToolOutput,
    taskId: input.taskId,
  });

  session.onGuard = (event) => {
    const current = guardStatsFromSession(session);
    if (event.action === "blocked") {
      session.flags.guardStats = { blocked: current.blocked + 1, flagSet: current.flagSet };
    } else if (event.action === "flag_set") {
      session.flags.guardStats = { blocked: current.blocked, flagSet: current.flagSet + 1 };
    }
    input.debug("lifecycle.guard", {
      guard: event.guardId,
      tool: event.toolName,
      action: event.action,
      detail: event.detail,
    });
  };

  input.debug("lifecycle.prepare", {
    task_id: input.taskId ?? null,
    model: input.model,
    mode: input.classifiedMode,
    history_messages: input.request.history.length,
    has_memory: Boolean(memoryOptions),
  });

  return { session, tools, agentInput, memoryOptions, promptUsage: requestInput.usage };
}

// --- Phase: Generate ---

function createLifecycleAgent(input: {
  soulPrompt: string;
  mode: AgentMode;
  workspace: string | undefined;
  model: string;
  tools: Partial<AcolyteToolset>;
}): Agent {
  return createAcolyte({
    model: input.model,
    instructions: createInstructions(input.soulPrompt, input.mode, input.workspace),
    tools: input.tools,
  });
}

function ensureAgentForMode(ctx: RunContext): void {
  const resolved = resolveModeModelOrThrow(ctx.mode, ctx.request.model);
  const nextModel = resolved.model;
  if (ctx.agentMode === ctx.mode && ctx.model === nextModel) return;

  const previousMode = ctx.agentMode;
  const previousModel = ctx.model;
  ctx.model = nextModel;
  ctx.agentMode = ctx.mode;
  ctx.agent = createLifecycleAgent({
    soulPrompt: ctx.soulPrompt,
    mode: ctx.mode,
    workspace: ctx.workspace,
    model: ctx.model,
    tools: ctx.tools,
  });
  ctx.debug("lifecycle.agent.reconfigured", {
    from_mode: previousMode,
    to_mode: ctx.mode,
    from_model: previousModel,
    to_model: ctx.model,
    provider: resolved.provider,
  });
}

async function phaseGenerate(ctx: RunContext, prompt: string, opts: GenerateOptions): Promise<void> {
  // Evaluators should only react to signals from the current generation attempt.
  ctx.lastError = undefined;
  ctx.lastErrorCode = undefined;
  ctx.lastErrorCategory = undefined;
  ctx.lastErrorSource = undefined;
  ctx.lastErrorTool = undefined;
  ctx.sawEditFileMultiMatchError = false;
  ensureAgentForMode(ctx);
  ctx.generationAttempt += 1;
  emitModeStatus(ctx);
  ctx.debug("lifecycle.generate.start", {
    model: ctx.model,
    mode: ctx.mode,
    max_steps: opts.maxSteps,
  });

  try {
    ctx.modelCallCount += 1;
    ctx.result = await streamWithTimeout(ctx, prompt, opts.maxSteps, opts.timeoutMs);
    ctx.debug("lifecycle.generate.done", {
      model: ctx.model,
      tool_calls: ctx.result.toolCalls.length,
      text_chars: ctx.result.text.trim().length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const timeoutCode = /timed out/i.test(errorMsg) ? LIFECYCLE_ERROR_CODES.timeout : undefined;
    captureError(ctx, errorMsg, { source: "generate", code: timeoutCode });
    ctx.emit({
      type: "error",
      error: `Tool failed: ${ctx.lastError}`,
      ...(ctx.lastErrorCode ? { errorCode: ctx.lastErrorCode } : {}),
      ...(currentErrorDetail(ctx) ? { errorDetail: currentErrorDetail(ctx) } : {}),
    });
    ctx.debug("lifecycle.generate.error", { model: ctx.model, error: ctx.lastError });
  }
}

// --- Stream processing ---

async function streamWithTimeout(
  ctx: RunContext,
  prompt: string,
  maxSteps: number,
  timeoutMs: number,
): Promise<GenerateResult> {
  return await new Promise<GenerateResult>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const resetTimeout = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Step timed out after ${timeoutMs}ms of inactivity`));
      }, timeoutMs);
    };
    resetTimeout();
    const temperature = appConfig.temperatures[ctx.mode];
    const modelSettings = typeof temperature === "number" ? { temperature } : undefined;

    ctx.agent
      .stream(prompt, {
        maxSteps,
        toolChoice: "auto",
        memory: ctx.memoryOptions,
        modelSettings,
      })
      .then(async (streamOutput) => {
        const reader = streamOutput.fullStream.getReader();
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (!chunk || typeof chunk !== "object") continue;
          const typed = chunk as { type?: string; payload?: unknown };
          resetTimeout();
          processStreamChunk(ctx, typed);
        }
        return await streamOutput.getFullOutput();
      })
      .then((value) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        resolve(value as GenerateResult);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function processStreamChunk(ctx: RunContext, chunk: StreamChunk): void {
  switch (chunk.type) {
    case "text-delta": {
      const p = chunk.payload as TextDeltaPayload | undefined;
      if (typeof p?.text === "string" && p.text.length > 0 && ctx.mode !== "verify")
        ctx.emit({ type: "text-delta", text: p.text });
      break;
    }
    case "reasoning-delta": {
      const p = chunk.payload as TextDeltaPayload | undefined;
      if (typeof p?.text === "string" && p.text.length > 0) ctx.emit({ type: "reasoning", text: p.text });
      break;
    }
    case "tool-call": {
      const p = chunk.payload as ToolCallPayload | undefined;
      if (p?.toolCallId && p?.toolName) {
        const toolName = canonicalToolId(p.toolName);
        ctx.observedTools.add(toolName);
        ctx.toolCallStartedAt.set(p.toolCallId, { toolName, startedAtMs: Date.now() });
        if (ctx.mode !== "verify") {
          const inferredMode = modeForTool(toolName);
          // Only escalate (plan → work), never de-escalate
          if (inferredMode === "work" && ctx.mode === "plan") {
            ctx.mode = "work";
            ctx.debug("lifecycle.mode.changed", { from: "plan", to: "work", trigger: toolName });
            emitModeStatus(ctx);
          }
        }
        const args = (p.args ?? {}) as Record<string, unknown>;
        ctx.debug("lifecycle.tool.call", { tool: toolName, ...formatToolArgs(args) });

        let queue = ctx.nativeIdQueue.get(toolName);
        if (!queue) {
          queue = [];
          ctx.nativeIdQueue.set(toolName, queue);
        }
        queue.push(p.toolCallId);

        ctx.emit({ type: "tool-call", toolCallId: p.toolCallId, toolName, args });
      }
      break;
    }
    case "tool-result": {
      const p = chunk.payload as ToolResultPayload | undefined;
      if (p?.toolCallId && p?.toolName) {
        const toolName = canonicalToolId(p.toolName);
        const started = ctx.toolCallStartedAt.get(p.toolCallId);
        if (started) {
          const durationMs = Date.now() - started.startedAtMs;
          ctx.debug("lifecycle.tool.result", {
            tool: toolName,
            tool_call_id: p.toolCallId,
            duration_ms: durationMs,
            is_error: false,
          });
          ctx.toolCallStartedAt.delete(p.toolCallId);
        }
        const queue = ctx.nativeIdQueue.get(toolName);
        if (queue?.[queue.length - 1] === p.toolCallId) queue.pop();
        const resultRecord =
          typeof p.result === "object" && p.result !== null ? (p.result as Record<string, unknown>) : null;
        const isError = Boolean(resultRecord && "error" in resultRecord);
        if (isError) {
          const parsed = parseErrorInfo(resultRecord?.error);
          const errorInfo = parsed.ok ? parsed.value : { message: "Tool error" };
          const resultCode = typeof resultRecord?.code === "string" ? resultRecord.code : undefined;
          captureError(ctx, errorInfo.message, {
            source: "tool-result",
            tool: toolName,
            code: resultCode ?? errorInfo.code,
          });
          ctx.debug("lifecycle.tool.error", { tool: toolName, error: ctx.lastError });
          ctx.debug("lifecycle.tool.result", {
            tool: toolName,
            tool_call_id: p.toolCallId,
            is_error: true,
          });
        }
        ctx.emit({
          type: "tool-result",
          toolCallId: p.toolCallId,
          toolName,
          ...(isError
            ? {
                isError: true,
                ...(ctx.lastErrorCode ? { errorCode: ctx.lastErrorCode } : {}),
                ...(currentErrorDetail(ctx) ? { errorDetail: currentErrorDetail(ctx) } : {}),
              }
            : {}),
        });
      }
      break;
    }
    case "tool-error": {
      const p = chunk.payload as ToolErrorPayload | undefined;
      const raw = p?.error ?? p?.message;
      const parsed = parseErrorInfo(raw);
      const errorInfo = parsed.ok ? parsed.value : { message: "Tool error" };
      const payloadCode = typeof p?.code === "string" ? p.code : undefined;
      const errorMsg = errorInfo.message;
      const toolName = canonicalToolId(p?.toolName ?? "");
      captureError(ctx, errorMsg, { source: "tool-error", tool: toolName, code: payloadCode ?? errorInfo.code });
      ctx.debug("lifecycle.tool.error", { tool: toolName, error: errorMsg });
      if (p?.toolCallId && p?.toolName) {
        const started = ctx.toolCallStartedAt.get(p.toolCallId);
        const durationMs = started ? Date.now() - started.startedAtMs : null;
        ctx.debug("lifecycle.tool.result", {
          tool: canonicalToolId(p.toolName),
          tool_call_id: p.toolCallId,
          duration_ms: durationMs,
          is_error: true,
        });
        ctx.toolCallStartedAt.delete(p.toolCallId);
        ctx.emit({
          type: "tool-result",
          toolCallId: p.toolCallId,
          toolName: canonicalToolId(p.toolName),
          isError: true,
          ...(ctx.lastErrorCode ? { errorCode: ctx.lastErrorCode } : {}),
          ...(currentErrorDetail(ctx) ? { errorDetail: currentErrorDetail(ctx) } : {}),
        });
      }
      break;
    }
  }
}

// --- Phase: Finalize ---

function phaseFinalize(ctx: RunContext): ChatResponse {
  const rawOutput = ctx.result?.text.trim() ?? "";
  const output = isReviewRequest(ctx.request.message)
    ? finalizeReviewOutput(rawOutput, ctx.request.message)
    : finalizeAssistantOutput(rawOutput, ctx.request.message, ctx.observedTools.size, ctx.lastError);

  const completionTokens = estimateTokens(output);
  let budgetWarning: string | undefined;
  if (ctx.promptUsage.promptTruncated) {
    const historyUnit = countLabel(ctx.promptUsage.totalHistoryMessages, "history message", "history messages").replace(
      /^\d+\s+/,
      "",
    );
    budgetWarning =
      `context trimmed (${ctx.promptUsage.includedHistoryMessages}/${ctx.promptUsage.totalHistoryMessages} ` +
      `${historyUnit})`;
  } else if (ctx.promptUsage.promptTokens >= Math.floor(ctx.promptUsage.promptBudgetTokens * 0.9)) {
    budgetWarning = `context near budget (${ctx.promptUsage.promptTokens}/${ctx.promptUsage.promptBudgetTokens} tokens)`;
  }

  const callLog = taskScopedCallLog(ctx.session, ctx.taskId);
  const guardStats = guardStatsFromSession(ctx.session);
  const totalToolCalls = callLog.length;
  const readCalls = callLog.filter((entry) => READ_TOOL_SET.has(entry.toolName)).length;
  const searchCalls = callLog.filter((entry) => SEARCH_TOOL_SET.has(entry.toolName)).length;
  const writeCalls = callLog.filter((entry) => WRITE_TOOL_SET.has(entry.toolName)).length;
  const firstWriteIndex = callLog.findIndex((entry) => WRITE_TOOL_SET.has(entry.toolName));
  const preWriteDiscoveryCalls =
    firstWriteIndex >= 0
      ? callLog.slice(0, firstWriteIndex).filter((entry) => DISCOVERY_TOOL_SET.has(entry.toolName)).length
      : callLog.filter((entry) => DISCOVERY_TOOL_SET.has(entry.toolName)).length;

  ctx.debug("lifecycle.summary", {
    task_id: ctx.taskId ?? null,
    mode: ctx.classifiedMode,
    model: ctx.model,
    model_calls: ctx.modelCallCount,
    tool_calls: totalToolCalls,
    unique_tool_count: ctx.observedTools.size,
    tools: Array.from(ctx.observedTools).join(","),
    has_error: Boolean(ctx.lastError),
    output_chars: output.length,
    budget_warning: budgetWarning ?? null,
    total_tool_calls: totalToolCalls,
    read_calls: readCalls,
    search_calls: searchCalls,
    write_calls: writeCalls,
    pre_write_discovery_calls: preWriteDiscoveryCalls,
    regeneration_count: ctx.regenerationCount,
    regeneration_limit_hit: ctx.regenerationLimitHit,
    guard_blocked_count: guardStats.blocked,
    guard_flag_set_count: guardStats.flagSet,
    last_error_code: ctx.lastErrorCode ?? null,
    last_error_category: ctx.lastErrorCategory ?? null,
    timeout_error_count: ctx.errorStats.timeout,
    file_not_found_error_count: ctx.errorStats["file-not-found"],
    guard_blocked_error_count: ctx.errorStats["guard-blocked"],
    other_error_count: ctx.errorStats.other,
  });

  return {
    model: ctx.model,
    output,
    toolCalls: callLog.map((entry) => entry.toolName),
    modelCalls: ctx.modelCallCount,
    usage: {
      promptTokens: ctx.promptUsage.promptTokens,
      completionTokens,
      totalTokens: ctx.promptUsage.promptTokens + completionTokens,
      promptBudgetTokens: ctx.promptUsage.promptBudgetTokens,
      promptTruncated: ctx.promptUsage.promptTruncated,
    },
    budgetWarning,
  };
}

// --- Runner ---

export async function runLifecycle(input: LifecycleInput): Promise<ChatResponse> {
  const emit = input.onEvent ?? (() => {});
  let debugSequence = 0;
  let debugPhaseAttempt = 0;
  const debugSink = input.onDebug ?? (() => {});
  const debug: RunContext["debug"] = (event, fields) => {
    debugSink({
      event,
      sequence: ++debugSequence,
      phaseAttempt: debugPhaseAttempt,
      ts: new Date().toISOString(),
      fields,
    });
  };

  const { classifiedMode, model } = phaseClassify(input.request, debug);

  const nativeIdQueue = new Map<string, string[]>();
  const toolCallStartedAt = new Map<string, ToolCallStart>();
  let toolOutputHandler: RunContext["toolOutputHandler"] = null;

  const prepared = phasePrepare({
    request: input.request,
    workspace: input.workspace,
    taskId: input.taskId,
    soulPrompt: input.soulPrompt,
    classifiedMode,
    model,
    debug,
    onToolOutput: (event) => {
      toolOutputHandler?.(event);
    },
  });

  const ctx: RunContext = {
    request: input.request,
    workspace: input.workspace,
    taskId: input.taskId,
    soulPrompt: input.soulPrompt,
    emit,
    debug,
    classifiedMode,
    tools: prepared.tools,
    mode: classifiedMode,
    agentMode: classifiedMode,
    model,
    session: prepared.session,
    agent: createLifecycleAgent({
      soulPrompt: input.soulPrompt,
      mode: classifiedMode,
      workspace: input.workspace,
      model,
      tools: prepared.tools,
    }),
    agentInput: prepared.agentInput,
    memoryOptions: prepared.memoryOptions,
    promptUsage: prepared.promptUsage,
    observedTools: new Set(),
    modelCallCount: 0,
    generationAttempt: 0,
    regenerationCount: 0,
    regenerationLimitHit: false,
    sawEditFileMultiMatchError: false,
    errorStats: createErrorStats(),
    lastErrorSource: undefined,
    lastErrorTool: undefined,
    nativeIdQueue,
    toolCallStartedAt,
    toolOutputHandler: null,
  };

  toolOutputHandler = (event) => {
    if (!event.message.trim()) return;
    const queue = ctx.nativeIdQueue.get(event.toolName);
    const nativeId = queue?.[queue.length - 1] ?? event.toolCallId ?? event.toolName;
    ctx.emit({
      type: "tool-output",
      toolCallId: nativeId,
      toolName: event.toolName,
      content: event.message,
    });
  };
  ctx.toolOutputHandler = toolOutputHandler;

  ctx.debug("lifecycle.start", { task_id: input.taskId ?? null, mode: classifiedMode, model });
  debugPhaseAttempt = ctx.generationAttempt + 1;
  await phaseGenerate(ctx, ctx.agentInput, {
    maxSteps: INITIAL_MAX_STEPS,
    timeoutMs: STEP_TIMEOUT_MS,
  });

  if (!ctx.result) return phaseFinalize(ctx);
  if (shouldYieldNow(ctx, input.shouldYield)) return phaseFinalize(ctx);

  const evaluators: Evaluator[] = [
    planDetector,
    multiMatchEditEvaluator,
    efficiencyEvaluator,
    timeoutRecovery,
    autoVerifier,
    verifyFailure,
  ];
  const regenByEvaluator = new Map<string, number>();
  let evaluatorChainRegenerations = 0;
  while (ctx.result) {
    if (shouldYieldNow(ctx, input.shouldYield)) break;
    if (
      recoveryActionForError({
        errorCode: ctx.lastErrorCode,
        unknownErrorCount: ctx.errorStats.other,
      }) === "stop-unknown-budget"
    ) {
      ctx.regenerationLimitHit = true;
      ctx.debug("lifecycle.eval.skipped", {
        reason: "unknown_error_budget",
        unknown_error_count: ctx.errorStats.other,
        unknown_error_cap: MAX_UNKNOWN_ERRORS_PER_REQUEST,
        last_error_code: ctx.lastErrorCode ?? null,
      });
      if (!ctx.result.text.trim()) {
        ctx.result = {
          text: "Stopped after repeated unknown errors. Narrow the task scope or inspect lifecycle traces and retry.",
          toolCalls: [],
        };
      }
      break;
    }
    let regenerated = false;
    for (const evaluator of evaluators) {
      if (shouldYieldNow(ctx, input.shouldYield)) break;
      const action = evaluator.evaluate(ctx);
      if (action.type === "done") {
        ctx.debug("lifecycle.eval.decision", { evaluator: evaluator.id, action: "done" });
        continue;
      }
      const evaluatorRegens = regenByEvaluator.get(evaluator.id) ?? 0;
      if (evaluatorChainRegenerations >= MAX_EVALUATOR_CHAIN_REGENERATIONS) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "chain_cap",
          chain_regenerations: evaluatorChainRegenerations,
          chain_cap: MAX_EVALUATOR_CHAIN_REGENERATIONS,
        });
        continue;
      }
      if (ctx.regenerationCount >= MAX_REGENERATIONS_PER_REQUEST) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "request_cap",
          regeneration_count: ctx.regenerationCount,
          regeneration_cap: MAX_REGENERATIONS_PER_REQUEST,
        });
        continue;
      }
      if (evaluatorRegens >= MAX_REGENERATIONS_PER_EVALUATOR) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "evaluator_cap",
          evaluator_regenerations: evaluatorRegens,
          evaluator_cap: MAX_REGENERATIONS_PER_EVALUATOR,
        });
        continue;
      }
      const saved: SavedRegenerationState | undefined = action.keepResult
        ? {
            result: ctx.result,
            lastError: ctx.lastError,
            lastErrorCode: ctx.lastErrorCode,
            lastErrorCategory: ctx.lastErrorCategory,
            lastErrorSource: ctx.lastErrorSource,
            lastErrorTool: ctx.lastErrorTool,
          }
        : undefined;
      if (action.mode) ctx.mode = action.mode;
      ctx.regenerationCount += 1;
      evaluatorChainRegenerations += 1;
      regenByEvaluator.set(evaluator.id, evaluatorRegens + 1);
      ctx.debug("lifecycle.eval.decision", {
        evaluator: evaluator.id,
        action: "regenerate",
        mode: ctx.mode,
        max_steps: action.maxSteps ?? INITIAL_MAX_STEPS,
        timeout_ms: action.timeoutMs ?? STEP_TIMEOUT_MS,
        keep_result: Boolean(action.keepResult),
        regeneration_count: ctx.regenerationCount,
        evaluator_regenerations: evaluatorRegens + 1,
      });
      debugPhaseAttempt = ctx.generationAttempt + 1;
      await phaseGenerate(ctx, action.prompt, {
        maxSteps: action.maxSteps ?? INITIAL_MAX_STEPS,
        timeoutMs: action.timeoutMs ?? STEP_TIMEOUT_MS,
      });
      if (shouldYieldNow(ctx, input.shouldYield)) break;
      if (saved) {
        ctx.result = saved.result;
        ctx.lastError = saved.lastError;
        ctx.lastErrorCode = saved.lastErrorCode;
        ctx.lastErrorCategory = saved.lastErrorCategory;
        ctx.lastErrorSource = saved.lastErrorSource;
        ctx.lastErrorTool = saved.lastErrorTool;
      }
      regenerated = true;
      break;
    }
    if (!regenerated) break;
  }

  return phaseFinalize(ctx);
}
