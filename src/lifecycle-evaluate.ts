import { type RecoveryAction, recoveryActionForError as resolveRecoveryAction } from "./error-handling";
import { t } from "./i18n";
import type { Effect, EffectAction, LifecycleInput, RegenerateAction, RunContext } from "./lifecycle-contract";
import { formatEffect, lintEffect } from "./lifecycle-effects";
import {
  type Evaluator,
  type EvaluatorPatch,
  guardRecoveryEvaluator,
  repeatedFailureEvaluator,
  toolRecoveryEvaluator,
} from "./lifecycle-evaluators";
import { phaseGenerate, shouldYieldNow } from "./lifecycle-generate";
import { defaultLifecyclePolicy, type LifecyclePolicy } from "./lifecycle-policy";
import { acceptedLifecycleSignal, updateRepeatedFailureState } from "./lifecycle-state";

const EFFECTS: Effect[] = [formatEffect, lintEffect];

const EVALUATORS: Evaluator[] = [guardRecoveryEvaluator, toolRecoveryEvaluator, repeatedFailureEvaluator];

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

function applyEvaluatorPatch(ctx: RunContext, patch?: EvaluatorPatch): void {
  if (!patch) return;
  if (patch.repeatedFailureStatus && ctx.lifecycleState.repeatedFailure) {
    ctx.lifecycleState.repeatedFailure = {
      ...ctx.lifecycleState.repeatedFailure,
      status: patch.repeatedFailureStatus,
    };
  }
}

export function recoveryActionForError(
  input: { errorCode?: string; unknownErrorCount: number },
  policy: LifecyclePolicy = defaultLifecyclePolicy,
): RecoveryAction {
  return resolveRecoveryAction(input, policy.maxUnknownErrorsPerRequest);
}

async function triggerRegeneration(
  ctx: RunContext,
  action: RegenerateAction,
  source: { kind: "effect" | "evaluator"; id: string },
  deps: PhaseEvaluateDeps,
  shouldYield: LifecycleInput["shouldYield"],
): Promise<boolean> {
  const regenerationReason = action.reason;
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

  ctx.regenerationCount += 1;
  ctx.regenerationCounts[regenerationReason] += 1;
  ctx.debug("lifecycle.eval.decision", {
    [source.kind]: source.id,
    action: "regenerate",
    cycle_limit: action.cycleLimit ?? ctx.policy.initialMaxSteps,
    feedback_source: action.feedback?.source ?? null,
    regeneration_reason: regenerationReason,
    regeneration_count: ctx.regenerationCount,
    regeneration_reason_count: ctx.regenerationCounts[regenerationReason],
  });

  if (action.feedback) ctx.lifecycleState.feedback.push(action.feedback);

  await deps.phaseGenerate(ctx, {
    cycleLimit: action.cycleLimit ?? ctx.policy.initialMaxSteps,
    timeoutMs: ctx.policy.stepTimeoutMs,
  });
  return !deps.shouldYieldNow(ctx, shouldYield);
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
      const outcome = evaluator.evaluate(ctx);
      if (outcome.debug) ctx.debug(outcome.debug.event, outcome.debug.fields);
      applyEvaluatorPatch(ctx, outcome.patch);
      const action = outcome.action;
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
