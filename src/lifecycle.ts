import { createErrorStats } from "./error-handling";
import type { LifecycleEventName, LifecycleInput, RunContext, ToolOutputEvent } from "./lifecycle-contract";
import { phaseEvaluate } from "./lifecycle-evaluate";
import { phaseFinalize } from "./lifecycle-finalize";
import { createModeAgent, phaseGenerate, shouldYieldNow } from "./lifecycle-generate";
import { resolveLifecyclePolicy } from "./lifecycle-policy";
import { phasePrepare } from "./lifecycle-prepare";
import { resolveInitialMode } from "./lifecycle-resolve";
import type { MemoryCommitContext, MemoryCommitMetrics } from "./memory-contract";
import { commitMemorySources } from "./memory-registry";
import { createInMemoryTaskQueue } from "./task-queue";
import { renderToolOutput } from "./tool-output-content";

const memoryCommitQueue = createInMemoryTaskQueue();

export function shouldCommitMemory(input: LifecycleInput): boolean {
  return input.request.useMemory !== false;
}

export function scheduleMemoryCommit(
  commitCtx: MemoryCommitContext,
  debug: RunContext["debug"],
  commitFn: (ctx: MemoryCommitContext) => Promise<MemoryCommitMetrics | undefined> = commitMemorySources,
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
    debug("lifecycle.memory.commit_done", {
      ...debugFields,
      project_promoted_facts: metrics?.projectPromotedFacts ?? 0,
      user_promoted_facts: metrics?.userPromotedFacts ?? 0,
      session_scoped_facts: metrics?.sessionScopedFacts ?? 0,
      dropped_untagged_facts: metrics?.droppedUntaggedFacts ?? 0,
    });
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
    initialMode: RunContext["initialMode"];
    model: string;
    prepared: ReturnType<typeof phasePrepare>;
    emit: RunContext["emit"];
    policy: RunContext["policy"];
  },
): RunContext {
  const agent = createModeAgent({
    soulPrompt: input.soulPrompt,
    mode: params.initialMode,
    workspace: input.workspace,
    model: params.model,
    tools: params.prepared.tools,
  });

  return {
    request: input.request,
    workspace: input.workspace,
    taskId: input.taskId,
    soulPrompt: input.soulPrompt,
    emit: params.emit,
    debug: params.debug,
    initialMode: params.initialMode,
    tools: params.prepared.tools,
    mode: params.initialMode,
    agentForMode: params.initialMode,
    model: params.model,
    session: Object.assign(params.prepared.session, {
      mode: params.initialMode,
      onDebug: (event: `lifecycle.${string}`, data: Record<string, unknown>) => params.debug(event, data),
    }),
    agent,
    agentInput: params.prepared.agentInput,
    policy: params.policy,
    promptUsage: params.prepared.promptUsage,
    observedTools: new Set(),
    modelCallCount: 0,
    promptTokensAccum: 0,
    completionTokensAccum: 0,
    streamingChars: 0,
    lastUsageEmitChars: 0,
    generationAttempt: 0,
    regenerationCount: 0,
    regenerationLimitHit: false,
    sawEditFileMultiMatchError: false,
    lastVerifyOutcome: undefined,
    errorStats: createErrorStats(),
    nativeIdQueue: new Map(),
    toolCallStartedAt: new Map(),
    toolOutputHandler: null,
  };
}

function attachToolOutputHandler(ctx: RunContext) {
  ctx.toolOutputHandler = (event) => {
    const rendered = renderToolOutput(event.content);
    if (!rendered.trim()) return;
    const toolName = event.toolName;
    const queue = ctx.nativeIdQueue.get(toolName);
    const resolvedToolCallId = queue?.[queue.length - 1] ?? event.toolCallId ?? toolName;
    ctx.debug("lifecycle.tool.output", {
      tool: toolName,
      stream_tool_call_id: event.toolCallId ?? null,
      emitted_tool_call_id: resolvedToolCallId,
      preview: rendered.length > 120 ? `${rendered.slice(0, 119)}…` : rendered,
    });
    ctx.emit({
      type: "tool-output",
      toolCallId: resolvedToolCallId,
      toolName,
      content: event.content,
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

  const { mode: initialMode, model } = resolveInitialMode(input.request, debug);

  const prepared = phasePrepare({
    request: input.request,
    workspace: input.workspace,
    taskId: input.taskId,
    soulPrompt: input.soulPrompt,
    initialMode,
    model,
    policy,
    debug,
    onOutput: (event: ToolOutputEvent) => {
      ctxRef?.toolOutputHandler?.(event);
    },
  });

  const ctx = createRunContext(input, { debug, initialMode, model, prepared, emit, policy });
  ctxRef = ctx;
  attachToolOutputHandler(ctx);
  ctx.session.flags.totalStepLimit = policy.totalMaxSteps;

  ctx.debug("lifecycle.start", { task_id: input.taskId ?? null, mode: initialMode, model });
  if (ctx.promptUsage.activeSkillName) {
    emit({ type: "status", message: `skill:${ctx.promptUsage.activeSkillName}` });
  }
  await phaseGenerate(ctx, ctx.agentInput, {
    cycleLimit: policy.initialMaxSteps,
    timeoutMs: policy.stepTimeoutMs,
  });

  if (!ctx.result) return phaseFinalize(ctx);
  if (shouldYieldNow(ctx, input.shouldYield)) return phaseFinalize(ctx);

  await phaseEvaluate(ctx, input.shouldYield);

  // Fire-and-forget: memory commit errors are logged but do not affect the response.
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
