import { type RecoveryAction, recoveryActionForError as resolveRecoveryAction } from "./error-handling";
import { t } from "./i18n";
import type {
  Effect,
  EffectAction,
  LifecycleInput,
  RegenerationReason,
  ReviewCandidate,
  ReviewResult,
  RunContext,
} from "./lifecycle-contract";
import { formatEffect, lintEffect } from "./lifecycle-effects";
import {
  type Evaluator,
  guardRecoveryEvaluator,
  repeatedFailureEvaluator,
  toolRecoveryEvaluator,
  verifyCycleEvaluator,
} from "./lifecycle-evaluators";
import { phaseGenerate, setMode, shouldYieldNow } from "./lifecycle-generate";
import { defaultLifecyclePolicy, type LifecyclePolicy } from "./lifecycle-policy";
import { acceptedLifecycleSignal, clearReviewStateForFeedback, updateRepeatedFailureState } from "./lifecycle-state";

const EFFECTS: Effect[] = [formatEffect, lintEffect];

const EVALUATORS: Evaluator[] = [
  guardRecoveryEvaluator,
  toolRecoveryEvaluator,
  verifyCycleEvaluator,
  repeatedFailureEvaluator,
];

type PhaseEvaluateDeps = {
  phaseGenerate: typeof phaseGenerate;
  shouldYieldNow: typeof shouldYieldNow;
  effects: readonly Effect[];
  evaluators: readonly Evaluator[];
};

const defaultPhaseEvaluateDeps: PhaseEvaluateDeps = {
  phaseGenerate,
  shouldYieldNow,
  effects: EFFECTS,
  evaluators: EVALUATORS,
};

function createReviewCandidate(ctx: RunContext): ReviewCandidate {
  return {
    result: ctx.result
      ? {
          text: ctx.result.text,
          toolCalls: [...ctx.result.toolCalls],
          ...(ctx.result.signal ? { signal: ctx.result.signal } : {}),
        }
      : undefined,
    currentError: ctx.currentError ? { ...ctx.currentError } : undefined,
  };
}

function restoreReviewCandidate(ctx: RunContext, candidate: ReviewCandidate): void {
  ctx.result = candidate.result;
  ctx.currentError = candidate.currentError;
  setMode(ctx, "work", "review-candidate");
}

function captureReviewResult(ctx: RunContext): ReviewResult {
  const details = ctx.result?.text.trim() || undefined;
  if (ctx.currentError) {
    return {
      status: "blocked",
      ...(details ? { details } : {}),
      error: ctx.currentError,
    };
  }

  switch (ctx.result?.signal) {
    case "no_op":
      return { status: "clean" };
    case "done":
      return { status: "issues", ...(details ? { details } : {}) };
    case "blocked":
      return { status: "blocked", ...(details ? { details } : {}) };
    default:
      return {
        status: "blocked",
        details: details ?? "Verify mode did not return a review verdict.",
      };
  }
}

export function recoveryActionForError(
  input: { errorCode?: string; unknownErrorCount: number },
  policy: LifecyclePolicy = defaultLifecyclePolicy,
): RecoveryAction {
  return resolveRecoveryAction(input, policy.maxUnknownErrorsPerRequest);
}

function regenerationReasonForAction(
  action: {
    feedback?: RunContext["lifecycleState"]["feedback"][number];
  },
  source: { kind: "effect" | "evaluator"; id: string },
): RegenerationReason {
  const feedbackSource = action.feedback?.source;
  if (feedbackSource === "lint") return "lint";
  if (feedbackSource === "verify") return "verify";
  if (feedbackSource === "tool-recovery") return "tool-recovery";
  if (feedbackSource === "repeated-failure") return "repeated-failure";
  return source.id === "guard-recovery" ? "guard-recovery" : "verify";
}

async function triggerRegeneration(
  ctx: RunContext,
  action: {
    feedback?: RunContext["lifecycleState"]["feedback"][number];
    mode?: RunContext["mode"];
    cycleLimit?: number;
  },
  source: { kind: "effect" | "evaluator"; id: string },
  deps: PhaseEvaluateDeps,
  shouldYield: LifecycleInput["shouldYield"],
): Promise<boolean> {
  const regenerationReason = regenerationReasonForAction(action, source);
  if (ctx.regenerationCount >= ctx.policy.maxRegenerationsPerRequest) {
    ctx.regenerationLimitHit = true;
    ctx.debug("lifecycle.eval.skipped", {
      [source.kind]: source.id,
      reason: "regeneration_cap",
      regeneration_reason: regenerationReason,
      regeneration_count: ctx.regenerationCount,
      regeneration_cap: ctx.policy.maxRegenerationsPerRequest,
    });
    return false;
  }

  const reasonCount = ctx.regenerationCounts[regenerationReason];
  const reasonCap = ctx.policy.maxRegenerationsPerReason[regenerationReason];
  if (reasonCount >= reasonCap) {
    ctx.regenerationLimitHit = true;
    ctx.debug("lifecycle.eval.skipped", {
      [source.kind]: source.id,
      reason: "regeneration_reason_cap",
      regeneration_reason: regenerationReason,
      regeneration_reason_count: reasonCount,
      regeneration_reason_cap: reasonCap,
    });
    return false;
  }

  const reviewCandidate = action.mode === "verify" ? createReviewCandidate(ctx) : undefined;
  if (action.mode) setMode(ctx, action.mode, source.id);

  ctx.regenerationCount += 1;
  ctx.regenerationCounts[regenerationReason] += 1;
  ctx.debug("lifecycle.eval.decision", {
    [source.kind]: source.id,
    action: "regenerate",
    mode: ctx.mode,
    cycle_limit: action.cycleLimit ?? ctx.policy.initialMaxSteps,
    feedback_source: action.feedback?.source ?? null,
    regeneration_reason: regenerationReason,
    regeneration_count: ctx.regenerationCount,
    regeneration_reason_count: ctx.regenerationCounts[regenerationReason],
  });

  clearReviewStateForFeedback(ctx, action.feedback?.source);
  if (action.feedback) ctx.lifecycleState.feedback.push(action.feedback);

  await deps.phaseGenerate(ctx, {
    cycleLimit: action.cycleLimit ?? ctx.policy.initialMaxSteps,
    timeoutMs: ctx.policy.stepTimeoutMs,
  });
  if (deps.shouldYieldNow(ctx, shouldYield)) return true;

  if (reviewCandidate && ctx.mode === "verify") {
    ctx.lifecycleState.reviewCandidate = reviewCandidate;
    ctx.lifecycleState.reviewResult = captureReviewResult(ctx);
  }

  if (reviewCandidate && ctx.lifecycleState.reviewResult?.status === "clean") {
    restoreReviewCandidate(ctx, reviewCandidate);
  }
  return true;
}

export async function phaseEvaluate(
  ctx: RunContext,
  shouldYield: LifecycleInput["shouldYield"],
  deps: PhaseEvaluateDeps = defaultPhaseEvaluateDeps,
) {
  while (ctx.result) {
    if (deps.shouldYieldNow(ctx, shouldYield)) break;
    const lifecycleSignal = acceptedLifecycleSignal(ctx);
    if (lifecycleSignal) {
      ctx.currentError = undefined;
      ctx.debug("lifecycle.signal.accepted", {
        signal: lifecycleSignal,
        mode: ctx.mode,
        tool_calls: ctx.result.toolCalls.length,
      });
    }
    updateRepeatedFailureState(ctx);

    if (
      recoveryActionForError({
        errorCode: ctx.currentError?.code,
        unknownErrorCount: ctx.errorStats.other,
      }) === "stop-unknown-budget"
    ) {
      ctx.regenerationLimitHit = true;
      ctx.debug("lifecycle.eval.skipped", {
        reason: "unknown_error_budget",
        unknown_error_count: ctx.errorStats.other,
        unknown_error_cap: ctx.policy.maxUnknownErrorsPerRequest,
        last_error_code: ctx.currentError?.code ?? null,
      });
      if (!ctx.result.text.trim()) {
        ctx.result = {
          text: t("lifecycle.stopped_unknown_errors"),
          toolCalls: [],
        };
      }
      break;
    }

    let regenerated = false;
    for (const effect of deps.effects) {
      if (deps.shouldYieldNow(ctx, shouldYield)) break;
      if (!effect.modes.includes(ctx.mode)) continue;
      const action: EffectAction = effect.run(ctx);
      if (action.type === "done") {
        ctx.debug("lifecycle.eval.decision", { effect: effect.id, action: "done" });
        continue;
      }
      regenerated = await triggerRegeneration(ctx, action, { kind: "effect", id: effect.id }, deps, shouldYield);
      break;
    }

    if (regenerated) continue;

    for (const evaluator of deps.evaluators) {
      if (deps.shouldYieldNow(ctx, shouldYield)) break;
      if (!evaluator.modes.includes(ctx.mode)) continue;
      const action = evaluator.evaluate(ctx);
      if (action.type === "done") {
        ctx.debug("lifecycle.eval.decision", { evaluator: evaluator.id, action: "done" });
        continue;
      }
      regenerated = await triggerRegeneration(ctx, action, { kind: "evaluator", id: evaluator.id }, deps, shouldYield);
      break;
    }
    if (!regenerated) break;
  }
}
