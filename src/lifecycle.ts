import { createErrorStats } from "./error-handling";
import type { LifecycleEventName, LifecycleInput, RunContext, ToolOutputEvent } from "./lifecycle-contract";
import { phaseEvaluate } from "./lifecycle-evaluate";
import { phaseFinalize } from "./lifecycle-finalize";
import { createModeAgent, phaseGenerate, shouldYieldNow } from "./lifecycle-generate";
import { createLifecycleFeedbackForGuard } from "./lifecycle-guard-feedback";
import { resolveLifecyclePolicy } from "./lifecycle-policy";
import { phasePrepare } from "./lifecycle-prepare";
import { resolveInitialMode } from "./lifecycle-resolve";
import { createEmptyPromptBreakdownTotals } from "./lifecycle-usage";
import type { MemoryCommitContext, MemoryCommitMetrics } from "./memory-contract";
import { commitMemorySources } from "./memory-registry";
import { createInMemoryTaskQueue } from "./task-queue";
import { renderToolOutputPart } from "./tool-output-content";
import { formatWorkspaceCommand, resolveWorkspaceProfile } from "./workspace-profile";

const memoryCommitQueue = createInMemoryTaskQueue();

export type LifecycleDeps = {
  resolveInitialMode: typeof resolveInitialMode;
  resolveLifecyclePolicy: typeof resolveLifecyclePolicy;
  phasePrepare: typeof phasePrepare;
  createModeAgent: typeof createModeAgent;
  phaseGenerate: typeof phaseGenerate;
  shouldYieldNow: typeof shouldYieldNow;
  phaseEvaluate: typeof phaseEvaluate;
  phaseFinalize: typeof phaseFinalize;
};

const defaultLifecycleDeps: LifecycleDeps = {
  resolveInitialMode,
  resolveLifecyclePolicy,
  phasePrepare,
  createModeAgent,
  phaseGenerate,
  shouldYieldNow,
  phaseEvaluate,
  phaseFinalize,
};

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
    createModeAgent: typeof createModeAgent;
  },
): RunContext {
  const session = params.prepared.session;
  const previousOnGuard = session.onGuard;
  const agent = params.createModeAgent({
    soulPrompt: input.soulPrompt,
    mode: params.initialMode,
    workspace: input.workspace,
    model: params.model,
    tools: params.prepared.tools,
  });

  const ctx: RunContext = {
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
    session: Object.assign(session, {
      mode: params.initialMode,
      onDebug: (event: `lifecycle.${string}`, data: Record<string, unknown>) => params.debug(event, data),
    }),
    agent,
    baseAgentInput: params.prepared.baseAgentInput,
    policy: params.policy,
    promptUsage: params.prepared.promptUsage,
    lifecycleState: {
      feedback: [],
      verifyOutcome: undefined,
      repeatedFailure: undefined,
    },
    observedTools: new Set(),
    modelCallCount: 0,
    inputTokensAccum: 0,
    outputTokensAccum: 0,
    promptBreakdownTotals: createEmptyPromptBreakdownTotals(),
    streamingChars: 0,
    lastUsageEmitChars: 0,
    generationAttempt: 0,
    regenerationCount: 0,
    regenerationLimitHit: false,
    errorStats: createErrorStats(),
    toolCallStartedAt: new Map(),
    toolOutputHandler: null,
  };

  session.onGuard = (event) => {
    previousOnGuard?.(event);
    const feedback = createLifecycleFeedbackForGuard(event, ctx.mode);
    if (!feedback) return;
    ctx.lifecycleState.feedback.push(feedback);
  };

  return ctx;
}

function attachToolOutputHandler(ctx: RunContext) {
  ctx.toolOutputHandler = (event) => {
    const rendered = renderToolOutputPart(event.content);
    if (!rendered.trim()) return;
    const toolName = event.toolName;
    const resolvedToolCallId = event.toolCallId ?? toolName;
    ctx.debug("lifecycle.tool.output", {
      tool: toolName,
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

export async function runLifecycle(input: LifecycleInput, deps: LifecycleDeps = defaultLifecycleDeps) {
  const emit = input.onEvent ?? (() => {});
  let policy = deps.resolveLifecyclePolicy(input.lifecyclePolicy);

  const profile = resolveWorkspaceProfile(input.workspace);
  if (profile.formatCommand || profile.lintCommand || profile.verifyCommand) {
    policy = {
      ...policy,
      ...(!policy.formatCommand && profile.formatCommand ? { formatCommand: profile.formatCommand } : {}),
      ...(!policy.lintCommand && profile.lintCommand ? { lintCommand: profile.lintCommand } : {}),
      ...(!policy.verifyCommand && profile.verifyCommand ? { verifyCommand: profile.verifyCommand } : {}),
    };
  }

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

  if (profile.ecosystem) {
    debug("lifecycle.workspace.profile", {
      ecosystem: profile.ecosystem,
      package_manager: profile.packageManager ?? null,
      lint_command: profile.lintCommand ? formatWorkspaceCommand(profile.lintCommand) : null,
      format_command: profile.formatCommand ? formatWorkspaceCommand(profile.formatCommand) : null,
      verify_command: profile.verifyCommand ? formatWorkspaceCommand(profile.verifyCommand) : null,
      line_width: profile.lineWidth ?? null,
    });
  }

  const { mode: initialMode, model } = deps.resolveInitialMode(input.request, debug);

  const prepared = deps.phasePrepare({
    request: input.request,
    workspace: input.workspace,
    taskId: input.taskId,
    soulPrompt: input.soulPrompt,
    memoryTokens: input.memoryTokens,
    initialMode,
    model,
    policy,
    debug,
    onOutput: (event: ToolOutputEvent) => {
      ctxRef?.toolOutputHandler?.(event);
    },
  });

  const ctx = createRunContext(input, {
    debug,
    initialMode,
    model,
    prepared,
    emit,
    policy,
    createModeAgent: deps.createModeAgent,
  });
  ctxRef = ctx;
  attachToolOutputHandler(ctx);
  ctx.session.flags.totalStepLimit = policy.totalMaxSteps;

  ctx.debug("lifecycle.start", { task_id: input.taskId ?? null, mode: initialMode, model });
  await deps.phaseGenerate(ctx, {
    cycleLimit: policy.initialMaxSteps,
    timeoutMs: policy.stepTimeoutMs,
  });

  if (!ctx.result) return deps.phaseFinalize(ctx);
  if (deps.shouldYieldNow(ctx, input.shouldYield)) return deps.phaseFinalize(ctx);

  await deps.phaseEvaluate(ctx, input.shouldYield);

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

  return deps.phaseFinalize(ctx);
}
