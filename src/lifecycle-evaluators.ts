import type { AgentMode } from "./agent-contract";
import type { VerifyScope } from "./api";
import type { LifecycleError, LifecycleEventName, LifecycleFeedback, LifecycleState } from "./lifecycle-contract";
import type { LifecyclePolicy } from "./lifecycle-policy";
import { haveChangesBeenVerified, type SessionContext, scopedCallLog } from "./tool-guards";
import { WRITE_TOOL_SET, WRITE_TOOLS } from "./tool-registry";

export type EvalAction =
  | { type: "done" }
  | {
      type: "regenerate";
      feedback?: LifecycleFeedback;
      mode?: AgentMode;
      cycleLimit?: number;
    };

export type EvaluatorContext = {
  result?: { text: string };
  observedTools: Set<string>;
  debug: (event: LifecycleEventName, fields?: Record<string, unknown>) => void;
  policy: LifecyclePolicy;
  initialMode: AgentMode;
  mode: AgentMode;
  taskId: string | undefined;
  session: SessionContext;
  workspace: string | undefined;
  request: { message: string; verifyScope?: VerifyScope };
  lifecycleState: LifecycleState;
  currentError?: LifecycleError;
};

export type Evaluator = {
  id: string;
  modes: readonly AgentMode[];
  evaluate: (ctx: EvaluatorContext) => EvalAction;
};

function formatToolRecovery(message: string, recovery: NonNullable<LifecycleError["recovery"]>): string {
  const hints: string[] = [];
  if (recovery.nextTool) hints.push(`Suggested next tool: ${recovery.nextTool}`);
  if (recovery.targetPaths && recovery.targetPaths.length > 0) {
    hints.push(`Suggested paths: ${recovery.targetPaths.join(", ")}`);
  }
  if (hints.length === 0) return message;
  return [message, ...hints].join("\n");
}

function hasRecoveredFromLastEditFileFailure(ctx: EvaluatorContext): boolean {
  const callLog = scopedCallLog(ctx.session, ctx.taskId);
  let lastFailIdx = -1;
  for (let i = callLog.length - 1; i >= 0; i--) {
    const entry = callLog[i];
    if (entry?.toolName === "file-edit" && entry.status === "failed") {
      lastFailIdx = i;
      break;
    }
  }
  if (lastFailIdx === -1) return false;
  return callLog
    .slice(lastFailIdx + 1)
    .some((entry) => WRITE_TOOL_SET.has(entry.toolName) && entry.status !== "failed");
}

export const guardRecoveryEvaluator: Evaluator = {
  id: "guard-recovery",
  modes: ["work", "verify"],
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.currentError?.category !== "guard-blocked") return { type: "done" };
    const hasPendingFeedback = ctx.lifecycleState.feedback.some(
      (feedback) => feedback.source === "guard" && feedback.mode === ctx.mode,
    );
    if (!hasPendingFeedback) return { type: "done" };
    ctx.debug("lifecycle.eval.guard_recovery", { mode: ctx.mode, error: ctx.currentError.message });
    return { type: "regenerate" };
  },
};

export const repeatedFailureEvaluator: Evaluator = {
  id: "repeated-failure",
  modes: ["work", "verify"],
  evaluate(ctx) {
    const repeatedFailure = ctx.lifecycleState.repeatedFailure;
    if (!ctx.result || !ctx.currentError || !repeatedFailure) return { type: "done" };
    if (ctx.currentError.category === "guard-blocked") return { type: "done" };
    if (repeatedFailure.count < 2) return { type: "done" };
    if (repeatedFailure.status === "surfaced") return { type: "done" };

    repeatedFailure.status = "surfaced";
    ctx.debug("lifecycle.eval.repeated_failure", {
      signature: repeatedFailure.signature,
      count: repeatedFailure.count,
      code: ctx.currentError.code ?? null,
      category: ctx.currentError.category ?? null,
      tool: ctx.currentError.tool ?? null,
    });

    return {
      type: "regenerate",
      feedback: {
        source: "repeated-failure",
        mode: ctx.mode,
        summary: "The same runtime failure has repeated.",
        details: ctx.currentError.message,
        instruction: "Do not retry the same failing move. Change approach before continuing.",
      },
    };
  },
};

export const verifyCycleEvaluator: Evaluator = {
  id: "verify-cycle",
  modes: ["work", "verify"],
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.request.verifyScope === "none") return { type: "done" };
    if (ctx.mode === "verify") {
      const reviewResult = ctx.lifecycleState.reviewResult;
      if (!reviewResult) return { type: "done" };
      ctx.debug("lifecycle.eval.verify_cycle", {
        status: reviewResult.status,
        has_error: Boolean(reviewResult.error),
        verify_scope: ctx.request.verifyScope ?? null,
      });
      if (reviewResult.status !== "issues") return { type: "done" };

      return {
        type: "regenerate",
        feedback: {
          source: "verify",
          mode: "work",
          summary: "Code review found issues to fix.",
          ...(reviewResult.details ? { details: reviewResult.details } : {}),
          instruction: "Fix the review findings, then continue.",
        },
        mode: "work",
      };
    }

    const usedWriteTools = WRITE_TOOLS.some((tool) => ctx.observedTools.has(tool));
    const verified =
      haveChangesBeenVerified(ctx.session, ctx.taskId) || ctx.lifecycleState.reviewResult?.status === "clean";
    ctx.debug("lifecycle.eval.verify_cycle", {
      used_write_tools: usedWriteTools,
      verified,
      verify_scope: ctx.request.verifyScope ?? null,
    });
    if (!(ctx.initialMode === "work" && usedWriteTools && !verified)) return { type: "done" };

    return {
      type: "regenerate",
      feedback: {
        source: "verify",
        mode: "verify",
        summary: "Review the changes for correctness.",
      },
      mode: "verify",
      cycleLimit: ctx.policy.verifyMaxSteps,
    };
  },
};

export const toolRecoveryEvaluator: Evaluator = {
  id: "tool-recovery",
  modes: ["work"],
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    const currentError = ctx.currentError;
    if (!currentError) return { type: "done" };
    const recovery = currentError.recovery;
    if (!recovery) return { type: "done" };
    if (
      recovery.tool === "file-edit" &&
      recovery.kind === "disambiguate-match" &&
      hasRecoveredFromLastEditFileFailure(ctx)
    ) {
      return { type: "done" };
    }

    ctx.debug("lifecycle.eval.tool_recovery", {
      error: currentError.message,
      recovery_tool: recovery.tool,
      recovery_kind: recovery.kind,
    });
    return {
      type: "regenerate",
      feedback: {
        source: "tool-recovery",
        mode: "work",
        summary: recovery.summary,
        details: formatToolRecovery(currentError.message, recovery),
        instruction: recovery.instruction,
      },
    };
  },
};
