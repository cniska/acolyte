import { type RecoveryAction, recoveryActionForError as resolveRecoveryAction } from "./error-handling";
import { t } from "./i18n";
import type {
  LifecycleEffect,
  LifecycleEffectAction,
  LifecycleInput,
  RunContext,
  SavedRegenerationState,
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
import { acceptedLifecycleSignal, clearVerifyOutcomeForFeedback, updateRepeatedFailureState } from "./lifecycle-state";

const EFFECTS: LifecycleEffect[] = [formatEffect, lintEffect];

const EVALUATORS: Evaluator[] = [
  guardRecoveryEvaluator,
  toolRecoveryEvaluator,
  verifyCycleEvaluator,
  repeatedFailureEvaluator,
];

type PhaseEvaluateDeps = {
  phaseGenerate: typeof phaseGenerate;
  shouldYieldNow: typeof shouldYieldNow;
  effects: readonly LifecycleEffect[];
  evaluators: readonly Evaluator[];
};

const defaultPhaseEvaluateDeps: PhaseEvaluateDeps = {
  phaseGenerate,
  shouldYieldNow,
  effects: EFFECTS,
  evaluators: EVALUATORS,
};

function snapshotState(ctx: RunContext): SavedRegenerationState {
  return {
    result: ctx.result,
    currentError: ctx.currentError,
  };
}

function restoreState(ctx: RunContext, saved: SavedRegenerationState): void {
  ctx.result = saved.result;
  ctx.currentError = saved.currentError;
}

export function recoveryActionForError(
  input: { errorCode?: string; unknownErrorCount: number },
  policy: LifecyclePolicy = defaultLifecyclePolicy,
): RecoveryAction {
  return resolveRecoveryAction(input, policy.maxUnknownErrorsPerRequest);
}

async function triggerRegeneration(
  ctx: RunContext,
  action: {
    feedback?: RunContext["lifecycleState"]["feedback"][number];
    mode?: RunContext["mode"];
    cycleLimit?: number;
    keepResult?: boolean;
  },
  source: { kind: "effect" | "evaluator"; id: string },
  deps: PhaseEvaluateDeps,
  shouldYield: LifecycleInput["shouldYield"],
): Promise<boolean> {
  if (ctx.regenerationCount >= ctx.policy.maxRegenerationsPerRequest) {
    ctx.regenerationLimitHit = true;
    ctx.debug("lifecycle.eval.skipped", {
      [source.kind]: source.id,
      reason: "regeneration_cap",
      regeneration_count: ctx.regenerationCount,
      regeneration_cap: ctx.policy.maxRegenerationsPerRequest,
    });
    return false;
  }

  const saved = action.keepResult ? snapshotState(ctx) : undefined;
  if (action.mode) setMode(ctx, action.mode, source.id);

  ctx.regenerationCount += 1;
  ctx.debug("lifecycle.eval.decision", {
    [source.kind]: source.id,
    action: "regenerate",
    mode: ctx.mode,
    cycle_limit: action.cycleLimit ?? ctx.policy.initialMaxSteps,
    keep_result: Boolean(action.keepResult),
    feedback_source: action.feedback?.source ?? null,
    regeneration_count: ctx.regenerationCount,
  });

  clearVerifyOutcomeForFeedback(ctx, action.feedback?.source);
  if (action.feedback) ctx.lifecycleState.feedback.push(action.feedback);

  await deps.phaseGenerate(ctx, {
    cycleLimit: action.cycleLimit ?? ctx.policy.initialMaxSteps,
    timeoutMs: ctx.policy.stepTimeoutMs,
  });
  if (deps.shouldYieldNow(ctx, shouldYield)) return true;

  if (saved && ctx.mode === "verify") {
    const verifySignal = ctx.result?.signal;
    ctx.lifecycleState.verifyOutcome = {
      text: ctx.result?.text ?? "",
      error: verifySignal === "done" || verifySignal === "no_op" ? undefined : ctx.currentError,
    };
  }

  if (saved) restoreState(ctx, saved);
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
      const action: LifecycleEffectAction = effect.run(ctx);
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
