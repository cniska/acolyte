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
import type { LifecycleEventName } from "./lifecycle-events";
import { createErrorStats } from "./error-handling";
import { canonicalToolId } from "./agent-output";
import { createLifecycleAgent, phaseGenerate, shouldYieldNow } from "./lifecycle-generate";
import { phaseFinalize } from "./lifecycle-finalize";
import { phasePrepare } from "./lifecycle-prepare";
import { phaseClassify } from "./lifecycle-classify";
import { phaseEvaluate, recoveryActionForError as resolveRecoveryAction } from "./lifecycle-evaluate";
import { resolveLifecyclePolicy } from "./lifecycle-policy";
import type { ToolOutputEvent } from "./lifecycle-contract";
import { type LifecycleInput, type RunContext } from "./lifecycle-contract";

export { autoVerifier, efficiencyEvaluator, multiMatchEditEvaluator, planDetector, timeoutRecovery, verifyFailure };
export type { EvalAction, Evaluator };
export type { LifecycleInput, RunContext } from "./lifecycle-contract";
export { resolveRecoveryAction as recoveryActionForError };

function createRunContext(input: LifecycleInput, params: {
  debug: RunContext["debug"];
  classifiedMode: RunContext["classifiedMode"];
  model: string;
  prepared: ReturnType<typeof phasePrepare>;
  emit: RunContext["emit"];
  policy: RunContext["policy"];
}): RunContext {
  return {
    request: input.request,
    workspace: input.workspace,
    taskId: input.taskId,
    soulPrompt: input.soulPrompt,
    emit: params.emit,
    debug: params.debug,
    classifiedMode: params.classifiedMode,
    tools: params.prepared.tools,
    mode: params.classifiedMode,
    agentMode: params.classifiedMode,
    model: params.model,
    session: params.prepared.session,
    agent: createLifecycleAgent({
      soulPrompt: input.soulPrompt,
      mode: params.classifiedMode,
      workspace: input.workspace,
      model: params.model,
      tools: params.prepared.tools,
    }),
    agentInput: params.prepared.agentInput,
    policy: params.policy,
    memoryOptions: params.prepared.memoryOptions,
    promptUsage: params.prepared.promptUsage,
    observedTools: new Set(),
    modelCallCount: 0,
    generationAttempt: 0,
    regenerationCount: 0,
    regenerationLimitHit: false,
    sawEditFileMultiMatchError: false,
    errorStats: createErrorStats(),
    lastErrorSource: undefined,
    lastErrorTool: undefined,
    nativeIdQueue: new Map(),
    toolCallStartedAt: new Map(),
    toolOutputHandler: null,
  };
}

function attachToolOutputHandler(ctx: RunContext) {
  ctx.toolOutputHandler = (event) => {
    if (!event.message.trim()) return;
    const toolName = canonicalToolId(event.toolName);
    const queue = ctx.nativeIdQueue.get(toolName);
    const nativeId = queue?.[queue.length - 1] ?? event.toolCallId ?? toolName;
    ctx.debug("lifecycle.tool.output", {
      tool: toolName,
      stream_tool_call_id: event.toolCallId ?? null,
      emitted_tool_call_id: nativeId,
      preview: event.message.length > 120 ? `${event.message.slice(0, 119)}…` : event.message,
    });
    ctx.emit({
      type: "tool-output",
      toolCallId: nativeId,
      toolName,
      content: event.message,
    });
  };
}

export async function runLifecycle(input: LifecycleInput) {
  const emit = input.onEvent ?? (() => {});
  const policy = resolveLifecyclePolicy(input.lifecyclePolicy);
  let debugSequence = 0;
  let ctxRef: RunContext | undefined;
  const debugSink = input.onDebug ?? (() => {});
  const debug: RunContext["debug"] = (event, fields) => {
    debugSink({
      event: event as LifecycleEventName,
      sequence: ++debugSequence,
      phaseAttempt: (ctxRef?.generationAttempt ?? 0) + 1,
      ts: new Date().toISOString(),
      fields,
    });
  };

  const { classifiedMode, model } = phaseClassify(input.request, debug);

  const prepared = phasePrepare({
    request: input.request,
    workspace: input.workspace,
    taskId: input.taskId,
    soulPrompt: input.soulPrompt,
    classifiedMode,
    model,
    debug,
    onToolOutput: (event: ToolOutputEvent) => {
      ctxRef?.toolOutputHandler?.(event);
    },
  });

  const ctx = createRunContext(input, { debug, classifiedMode, model, prepared, emit, policy });
  ctxRef = ctx;
  attachToolOutputHandler(ctx);

  ctx.debug("lifecycle.start", { task_id: input.taskId ?? null, mode: classifiedMode, model });
  await phaseGenerate(ctx, ctx.agentInput, {
    maxSteps: policy.initialMaxSteps,
    timeoutMs: policy.stepTimeoutMs,
  });

  if (!ctx.result) return phaseFinalize(ctx);
  if (shouldYieldNow(ctx, input.shouldYield)) return phaseFinalize(ctx);

  await phaseEvaluate(ctx, input.shouldYield);

  return phaseFinalize(ctx);
}
