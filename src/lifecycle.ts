import { estimateTokens } from "./agent-input";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import { createErrorStats } from "./error-handling";
import { t } from "./i18n";
import type {
  LifecycleEventName,
  LifecycleInput,
  LifecycleSignal,
  RunContext,
  ToolOutputEvent,
} from "./lifecycle-contract";
import { POST_EFFECTS, PRE_EFFECTS } from "./lifecycle-effects";
import { phaseFinalize } from "./lifecycle-finalize";
import { createRunAgent, phaseGenerate } from "./lifecycle-generate";
import { resolveLifecyclePolicy } from "./lifecycle-policy";
import { phasePrepare } from "./lifecycle-prepare";
import { resolveModel } from "./lifecycle-resolve";
import { createEmptyPromptBreakdownTotals } from "./lifecycle-usage";
import type { MemoryCommitContext, MemoryCommitMetrics } from "./memory-contract";
import { commitDistiller, DISTILLER_PROMPT } from "./memory-distiller";
import { createInMemoryTaskQueue } from "./task-queue";
import { renderToolOutputPart } from "./tool-output-content";
import { DISCOVERY_TOOL_SET, WRITE_TOOL_SET } from "./tool-registry";
import { scopedCallLog } from "./tool-session";
import { formatWorkspaceCommand, resolveWorkspaceProfile } from "./workspace-profile";
import { resolveWorkspaceSandboxRoot } from "./workspace-sandbox";

const memoryCommitQueue = createInMemoryTaskQueue();

export type LifecycleDeps = {
  resolveModel: typeof resolveModel;
  resolveLifecyclePolicy: typeof resolveLifecyclePolicy;
  phasePrepare: typeof phasePrepare;
  createRunAgent: typeof createRunAgent;
  phaseGenerate: typeof phaseGenerate;
  phaseFinalize: typeof phaseFinalize;
};

const defaultLifecycleDeps: LifecycleDeps = {
  resolveModel,
  resolveLifecyclePolicy,
  phasePrepare,
  createRunAgent,
  phaseGenerate,
  phaseFinalize,
};

export function shouldCommitMemory(input: LifecycleInput): boolean {
  return input.request.useMemory !== false;
}

export function scheduleMemoryCommit(
  commitCtx: MemoryCommitContext,
  debug: RunContext["debug"],
  onCommit?: (metrics: MemoryCommitMetrics) => void,
  commitFn: (ctx: MemoryCommitContext) => Promise<MemoryCommitMetrics | undefined> = commitDistiller,
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
    if (metrics) onCommit?.(metrics);
    debug("lifecycle.memory.commit_done", {
      ...debugFields,
      project_promoted_facts: metrics?.projectPromotedFacts ?? 0,
      user_promoted_facts: metrics?.userPromotedFacts ?? 0,
      session_scoped_facts: metrics?.sessionScopedFacts ?? 0,
      dropped_untagged_facts: metrics?.droppedUntaggedFacts ?? 0,
      distill_tokens: metrics?.distillTokens ?? 0,
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
    model: string;
    prepared: ReturnType<typeof phasePrepare>;
    emit: RunContext["emit"];
    policy: RunContext["policy"];
    createRunAgent: typeof createRunAgent;
  },
): RunContext {
  const session = params.prepared.session;
  const agent = params.createRunAgent({
    soulPrompt: input.soulPrompt,
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
    tools: params.prepared.tools,
    model: params.model,
    session: Object.assign(session, {
      onDebug: (event: `lifecycle.${string}`, data: Record<string, unknown>) => params.debug(event, data),
    }),
    agent,
    baseAgentInput: params.prepared.baseAgentInput,
    policy: params.policy,
    promptUsage: params.prepared.promptUsage,
    observedTools: new Set(),
    modelCallCount: 0,
    inputTokensAccum: 0,
    outputTokensAccum: 0,
    promptBreakdownTotals: createEmptyPromptBreakdownTotals(),
    streamingChars: 0,
    lastUsageEmitChars: 0,
    errorStats: createErrorStats(),
    toolCallStartedAt: new Map(),
    toolOutputHandler: null,
  };

  session.onBeforeTool = (preCtx) => runPreEffects(ctx, preCtx);
  session.onAfterTool = (toolResult) => runPostEffects(ctx, toolResult);

  return ctx;
}

function runPreEffects(
  ctx: RunContext,
  { toolId }: { toolId: string; args: Record<string, unknown> },
): { append: string } | undefined {
  if (DISCOVERY_TOOL_SET.has(toolId)) return undefined;
  for (const effect of PRE_EFFECTS) {
    effect.run(ctx);
  }
  return undefined;
}

function runPostEffects(
  ctx: RunContext,
  { toolId, args }: { toolId: string; args: Record<string, unknown> },
): { append: string } | undefined {
  if (!WRITE_TOOL_SET.has(toolId)) return undefined;
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (!path) return undefined;
  const paths = [path];
  let lintOutput: string | undefined;
  for (const effect of POST_EFFECTS) {
    const result = effect.run(ctx, paths);
    if (result.lintOutput) lintOutput = result.lintOutput;
  }
  return lintOutput ? { append: `Lint errors:\n${lintOutput}` } : undefined;
}

export function resolveSignal(ctx: RunContext): LifecycleSignal | undefined {
  const signal = ctx.result?.signal;
  if (!signal) return undefined;
  if (ctx.currentError) return undefined;
  if (signal === "no_op" && scopedCallLog(ctx.session, ctx.taskId).some((e) => WRITE_TOOL_SET.has(e.toolName)))
    return undefined;
  if (signal === "done" || signal === "no_op" || signal === "blocked") return signal;
  return undefined;
}

function acceptResult(ctx: RunContext): void {
  const lifecycleSignal = resolveSignal(ctx);
  if (lifecycleSignal) {
    ctx.currentError = undefined;
    ctx.debug("lifecycle.signal.accepted", {
      signal: lifecycleSignal,
      tool_calls: ctx.result?.toolCalls.length ?? 0,
    });
  }

  const errorBudgetExhausted =
    ctx.currentError?.code === LIFECYCLE_ERROR_CODES.unknown &&
    ctx.errorStats.other >= ctx.policy.maxUnknownErrorsPerRequest;
  if (errorBudgetExhausted) {
    ctx.debug("lifecycle.eval.skipped", {
      reason: "unknown_error_budget",
      unknown_error_count: ctx.errorStats.other,
      unknown_error_cap: ctx.policy.maxUnknownErrorsPerRequest,
      last_error_code: ctx.currentError?.code ?? null,
    });
    if (ctx.result && !ctx.result.text.trim()) {
      ctx.result = { text: t("lifecycle.stopped_unknown_errors"), toolCalls: [] };
    }
  }
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
  if (profile.installCommand || profile.formatCommand || profile.lintCommand) {
    policy = {
      ...policy,
      ...(!policy.installCommand && profile.installCommand ? { installCommand: profile.installCommand } : {}),
      ...(!policy.formatCommand && profile.formatCommand ? { formatCommand: profile.formatCommand } : {}),
      ...(!policy.lintCommand && profile.lintCommand ? { lintCommand: profile.lintCommand } : {}),
    };
  }

  let debugSequence = 0;
  let ctxRef: RunContext | undefined;
  const debugSink = input.onDebug ?? (() => {});
  const debug: RunContext["debug"] = (event, fields) => {
    debugSink({
      event: event as LifecycleEventName,
      sequence: ++debugSequence,
      ts: new Date().toISOString(),
      fields,
    });
  };

  if (profile.ecosystem) {
    debug("lifecycle.workspace.profile", {
      ecosystem: profile.ecosystem,
      package_manager: profile.packageManager ?? null,
      install_command: profile.installCommand ? formatWorkspaceCommand(profile.installCommand) : null,
      lint_command: profile.lintCommand ? formatWorkspaceCommand(profile.lintCommand) : null,
      format_command: profile.formatCommand ? formatWorkspaceCommand(profile.formatCommand) : null,
      test_command: profile.testCommand ? formatWorkspaceCommand(profile.testCommand) : null,
    });
  }

  const sandboxWorkspace = input.workspace ?? process.cwd();
  debug("lifecycle.workspace.sandbox", {
    workspace: sandboxWorkspace,
    sandbox_root: resolveWorkspaceSandboxRoot(sandboxWorkspace),
  });

  const { model } = deps.resolveModel(input.request.model);

  const prepared = deps.phasePrepare({
    request: input.request,
    workspace: input.workspace,
    taskId: input.taskId,
    soulPrompt: input.soulPrompt,
    model,
    policy,
    debug,
    onOutput: (event: ToolOutputEvent) => {
      ctxRef?.toolOutputHandler?.(event);
    },
    onChecklist: (event) => {
      emit({ type: "checklist", groupId: event.groupId, groupTitle: event.groupTitle, items: event.items });
    },
  });

  const ctx = createRunContext(input, {
    debug,
    model,
    prepared,
    emit,
    policy,
    createRunAgent: deps.createRunAgent,
  });
  ctxRef = ctx;
  attachToolOutputHandler(ctx);
  ctx.session.flags.totalStepLimit = policy.totalMaxSteps;
  if (profile.ecosystem) ctx.session.workspaceProfile = profile;

  ctx.debug("lifecycle.start", { task_id: input.taskId ?? null, model });
  await deps.phaseGenerate(ctx, {
    cycleLimit: policy.initialMaxSteps,
    timeoutMs: policy.stepTimeoutMs,
  });

  if (!ctx.result) return deps.phaseFinalize(ctx);
  if (input.shouldYield?.()) {
    ctx.debug("lifecycle.yield", {});
    if (!ctx.result.text.trim()) {
      ctx.result = { text: "Yielding to a newer pending message.", toolCalls: ctx.result.toolCalls };
    }
    return deps.phaseFinalize(ctx);
  }

  acceptResult(ctx);

  // Fire-and-forget: memory commit errors are logged but do not affect the response.
  if (ctx.result && shouldCommitMemory(input)) {
    const commitMessages = [
      ...ctx.request.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: ctx.request.message },
    ];
    // Estimate distill cost: observer prompt + input + estimated output
    const distillInput = [...commitMessages, { role: "assistant", content: ctx.result.text }]
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");
    ctx.promptUsage.memoryTokens = estimateTokens(DISTILLER_PROMPT) + estimateTokens(distillInput);
    scheduleMemoryCommit(
      {
        sessionId: ctx.request.sessionId,
        resourceId: ctx.request.resourceId,
        workspace: ctx.workspace,
        messages: commitMessages,
        output: ctx.result.text,
      },
      ctx.debug,
      input.onMemoryCommit,
    );
  }

  return deps.phaseFinalize(ctx);
}
