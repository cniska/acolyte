import { createErrorStats } from "./error-handling";
import { phaseClassify } from "./lifecycle-classify";
import type { LifecycleInput, RunContext, ToolOutputEvent } from "./lifecycle-contract";
import { phaseEvaluate, recoveryActionForError as resolveRecoveryAction } from "./lifecycle-evaluate";
import {
  autoVerifier,
  commitCompletionEvaluator,
  type EvalAction,
  type Evaluator,
  efficiencyEvaluator,
  missingPrerequisiteRecovery,
  multiMatchEditEvaluator,
  planDetector,
  timeoutRecovery,
  verifyFailure,
} from "./lifecycle-evaluators";
import type { LifecycleEventName } from "./lifecycle-events";
import { phaseFinalize } from "./lifecycle-finalize";
import { createModeAgent, phaseGenerate, shouldYieldNow } from "./lifecycle-generate";
import { resolveLifecyclePolicy } from "./lifecycle-policy";
import { phasePrepare } from "./lifecycle-prepare";
import type { MemoryCommitContext, MemoryCommitMetrics } from "./memory-contract";
import { commitMemorySources } from "./memory-registry";
import { createInMemoryTaskQueue } from "./task-queue";

const memoryCommitQueue = createInMemoryTaskQueue();
const malformedMemoryRejectStreakBySession = new Map<string, number>();

export {
  autoVerifier,
  commitCompletionEvaluator,
  efficiencyEvaluator,
  missingPrerequisiteRecovery,
  multiMatchEditEvaluator,
  planDetector,
  timeoutRecovery,
  verifyFailure,
};
export type { EvalAction, Evaluator };
export type { LifecycleInput, RunContext } from "./lifecycle-contract";
export { resolveRecoveryAction as recoveryActionForError };

export function shouldCommitMemory(input: LifecycleInput): boolean {
  return input.request.useMemory !== false;
}

export function scheduleMemoryCommit(
  commitCtx: MemoryCommitContext,
  debug: RunContext["debug"],
  commitFn: (ctx: MemoryCommitContext) => Promise<MemoryCommitMetrics | void> = commitMemorySources,
  enqueueFn: (key: string, job: () => Promise<void>) => Promise<void> = (key, job) =>
    memoryCommitQueue.enqueue(key, job),
): void {
  const key = commitCtx.sessionId ?? "session:unknown";
  const debugFields = {
    queue_key: key,
    session_id: commitCtx.sessionId ?? null,
    message_count: commitCtx.messages.length,
    output_chars: commitCtx.output.length,
  };
  debug("lifecycle.memory.commit_scheduled", debugFields);
  void enqueueFn(key, async () => {
    const metrics = await commitFn(commitCtx);
    const malformedTaggedFacts = metrics?.malformedTaggedFacts ?? 0;
    const malformedRejectStreak =
      malformedTaggedFacts > 0 ? (malformedMemoryRejectStreakBySession.get(key) ?? 0) + 1 : 0;
    if (malformedRejectStreak > 0) malformedMemoryRejectStreakBySession.set(key, malformedRejectStreak);
    else malformedMemoryRejectStreakBySession.delete(key);
    debug("lifecycle.memory.commit_done", {
      ...debugFields,
      project_promoted_facts: metrics?.projectPromotedFacts ?? 0,
      user_promoted_facts: metrics?.userPromotedFacts ?? 0,
      session_scoped_facts: metrics?.sessionScopedFacts ?? 0,
      dropped_untagged_facts: metrics?.droppedUntaggedFacts ?? 0,
      malformed_tagged_facts: malformedTaggedFacts,
      malformed_reject_streak: malformedRejectStreak,
    });
    if (malformedRejectStreak >= 2) {
      debug("lifecycle.memory.quality_warning", {
        ...debugFields,
        warning: "repeated_malformed_scope_tags",
        malformed_tagged_facts: malformedTaggedFacts,
        malformed_reject_streak: malformedRejectStreak,
      });
    }
  }).catch((error) => {
    debug("lifecycle.memory.commit_failed", {
      ...debugFields,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

function createRunContext(
  input: LifecycleInput,
  params: {
    debug: RunContext["debug"];
    classifiedMode: RunContext["classifiedMode"];
    model: string;
    prepared: ReturnType<typeof phasePrepare>;
    emit: RunContext["emit"];
    policy: RunContext["policy"];
  },
): RunContext {
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
    agent: createModeAgent({
      soulPrompt: input.soulPrompt,
      mode: params.classifiedMode,
      workspace: input.workspace,
      model: params.model,
      tools: params.prepared.tools,
    }),
    agentInput: params.prepared.agentInput,
    policy: params.policy,
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
    const toolName = event.toolName;
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
  if (ctx.promptUsage.activeSkillName) {
    emit({ type: "status", message: `skill:${ctx.promptUsage.activeSkillName}` });
  }
  await phaseGenerate(ctx, ctx.agentInput, {
    maxSteps: policy.initialMaxSteps,
    timeoutMs: policy.stepTimeoutMs,
  });

  if (!ctx.result) return phaseFinalize(ctx);
  if (shouldYieldNow(ctx, input.shouldYield)) return phaseFinalize(ctx);

  await phaseEvaluate(ctx, input.shouldYield);

  if (ctx.result && shouldCommitMemory(input)) {
    scheduleMemoryCommit(
      {
        sessionId: ctx.request.sessionId,
        resourceId: ctx.request.resourceId,
        workspace: ctx.workspace,
        messages: [
          ...ctx.request.history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: ctx.request.message },
        ],
        output: ctx.result.text,
      },
      ctx.debug,
    );
  }

  return phaseFinalize(ctx);
}
