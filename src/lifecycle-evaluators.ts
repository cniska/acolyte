import type { AgentMode } from "./agent-contract";
import type { VerifyScope } from "./api";
import type {
  GenerateResult,
  LifecycleError,
  LifecycleEventName,
  LifecycleFeedback,
  LifecycleState,
  RegenerateAction,
  ReviewCandidate,
  ReviewResult,
} from "./lifecycle-contract";
import type { LifecyclePolicy } from "./lifecycle-policy";
import { haveChangesBeenVerified, type SessionContext, scopedCallLog } from "./tool-guards";
import { WRITE_TOOL_SET, WRITE_TOOLS } from "./tool-registry";

export type EvaluatorAction = { type: "done" } | RegenerateAction;

type EvaluatorLifecycleState = {
  readonly feedback: readonly LifecycleFeedback[];
  readonly reviewCandidate?: Readonly<ReviewCandidate>;
  readonly reviewResult?: Readonly<ReviewResult>;
  readonly repeatedFailure?: Readonly<NonNullable<LifecycleState["repeatedFailure"]>>;
};

export type EvaluatorPatch = {
  repeatedFailureStatus?: NonNullable<LifecycleState["repeatedFailure"]>["status"];
};

export type EvaluatorDebug = {
  event: LifecycleEventName;
  fields?: Record<string, unknown>;
};

export type EvaluatorResult = {
  action: EvaluatorAction;
  patch?: EvaluatorPatch;
  debug?: EvaluatorDebug;
};

export type EvaluatorContext = {
  readonly result?: Readonly<GenerateResult>;
  readonly observedTools: ReadonlySet<string>;
  readonly policy: LifecyclePolicy;
  readonly initialMode: AgentMode;
  readonly mode: AgentMode;
  readonly taskId: string | undefined;
  readonly session: Readonly<SessionContext>;
  readonly workspace: string | undefined;
  readonly request: { readonly message: string; readonly verifyScope?: VerifyScope };
  readonly lifecycleState: EvaluatorLifecycleState;
  readonly currentError?: LifecycleError;
};

export type Evaluator = {
  id: string;
  modes: readonly AgentMode[];
  evaluate: (ctx: EvaluatorContext) => EvaluatorResult;
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
    if (!ctx.result) return { action: { type: "done" } };
    if (ctx.currentError?.category !== "guard-blocked") return { action: { type: "done" } };
    const hasPendingFeedback = ctx.lifecycleState.feedback.some(
      (feedback) => feedback.source === "guard" && feedback.mode === ctx.mode,
    );
    if (!hasPendingFeedback) return { action: { type: "done" } };
    return {
      action: { type: "regenerate", reason: "guard-recovery" },
      debug: {
        event: "lifecycle.eval.guard_recovery",
        fields: { mode: ctx.mode, error: ctx.currentError.message },
      },
    };
  },
};

export const repeatedFailureEvaluator: Evaluator = {
  id: "repeated-failure",
  modes: ["work", "verify"],
  evaluate(ctx) {
    const repeatedFailure = ctx.lifecycleState.repeatedFailure;
    if (!ctx.result || !ctx.currentError || !repeatedFailure) return { action: { type: "done" } };
    if (ctx.currentError.category === "guard-blocked") return { action: { type: "done" } };
    if (repeatedFailure.count < 2) return { action: { type: "done" } };
    if (repeatedFailure.status === "surfaced") return { action: { type: "done" } };

    return {
      action: {
        type: "regenerate",
        reason: "repeated-failure",
        feedback: {
          source: "repeated-failure",
          summary: "The same runtime failure has repeated.",
          details: ctx.currentError.message,
          instruction: "Do not retry the same failing move. Change approach before continuing.",
        },
      },
      patch: { repeatedFailureStatus: "surfaced" },
      debug: {
        event: "lifecycle.eval.repeated_failure",
        fields: {
          signature: repeatedFailure.signature,
          count: repeatedFailure.count,
          code: ctx.currentError.code ?? null,
          category: ctx.currentError.category ?? null,
          tool: ctx.currentError.tool ?? null,
        },
      },
    };
  },
};

export const verifyCycleEvaluator: Evaluator = {
  id: "verify-cycle",
  modes: ["work", "verify"],
  evaluate(ctx) {
    if (!ctx.result) return { action: { type: "done" } };
    if (ctx.request.verifyScope === "none") return { action: { type: "done" } };
    if (ctx.mode === "verify") {
      const reviewResult = ctx.lifecycleState.reviewResult;
      if (!reviewResult) return { action: { type: "done" } };
      if (reviewResult.status !== "issues") {
        return {
          action: { type: "done" },
          debug: {
            event: "lifecycle.eval.verify_cycle",
            fields: {
              status: reviewResult.status,
              verify_scope: ctx.request.verifyScope ?? null,
            },
          },
        };
      }

      return {
        action: {
          type: "regenerate",
          reason: "verify",
          feedback: {
            source: "verify",
            summary: "Code review found issues to fix.",
            ...(reviewResult.details ? { details: reviewResult.details } : {}),
            instruction: "Fix the review findings, then continue.",
          },
          transition: { to: "work" },
        },
        debug: {
          event: "lifecycle.eval.verify_cycle",
          fields: {
            status: reviewResult.status,
            verify_scope: ctx.request.verifyScope ?? null,
          },
        },
      };
    }

    const usedWriteTools = WRITE_TOOLS.some((tool) => ctx.observedTools.has(tool));
    const verified =
      haveChangesBeenVerified(ctx.session, ctx.taskId) || ctx.lifecycleState.reviewResult?.status === "clean";
    if (!(ctx.initialMode === "work" && usedWriteTools && !verified)) {
      return {
        action: { type: "done" },
        debug: {
          event: "lifecycle.eval.verify_cycle",
          fields: {
            used_write_tools: usedWriteTools,
            verified,
            verify_scope: ctx.request.verifyScope ?? null,
          },
        },
      };
    }

    return {
      action: {
        type: "regenerate",
        reason: "verify",
        feedback: {
          source: "verify",
          summary: "Review the changes for correctness.",
        },
        transition: { to: "verify" },
        cycleLimit: ctx.policy.verifyMaxSteps,
      },
      debug: {
        event: "lifecycle.eval.verify_cycle",
        fields: {
          used_write_tools: usedWriteTools,
          verified,
          verify_scope: ctx.request.verifyScope ?? null,
        },
      },
    };
  },
};

export const toolRecoveryEvaluator: Evaluator = {
  id: "tool-recovery",
  modes: ["work"],
  evaluate(ctx) {
    if (!ctx.result) return { action: { type: "done" } };
    const currentError = ctx.currentError;
    if (!currentError) return { action: { type: "done" } };
    const recovery = currentError.recovery;
    if (!recovery) return { action: { type: "done" } };
    if (
      recovery.tool === "file-edit" &&
      recovery.kind === "disambiguate-match" &&
      hasRecoveredFromLastEditFileFailure(ctx)
    ) {
      return { action: { type: "done" } };
    }

    return {
      action: {
        type: "regenerate",
        reason: "tool-recovery",
        feedback: {
          source: "tool-recovery",
          summary: recovery.summary,
          details: formatToolRecovery(currentError.message, recovery),
          instruction: recovery.instruction,
        },
      },
      debug: {
        event: "lifecycle.eval.tool_recovery",
        fields: {
          error: currentError.message,
          recovery_tool: recovery.tool,
          recovery_kind: recovery.kind,
        },
      },
    };
  },
};
