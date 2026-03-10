import { type RecoveryAction, recoveryActionForError as resolveRecoveryAction } from "./error-handling";
import { t } from "./i18n";
import type { LifecycleInput, RunContext, SavedRegenerationState } from "./lifecycle-contract";
import { type Evaluator, multiMatchEditEvaluator, verifyCycle } from "./lifecycle-evaluators";
import { phaseGenerate, setMode, shouldYieldNow } from "./lifecycle-generate";
import { defaultLifecyclePolicy, type LifecyclePolicy } from "./lifecycle-policy";

const EVALUATORS: Evaluator[] = [multiMatchEditEvaluator, verifyCycle];

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

export async function phaseEvaluate(ctx: RunContext, shouldYield: LifecycleInput["shouldYield"]) {
  while (ctx.result) {
    if (shouldYieldNow(ctx, shouldYield)) break;

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
    for (const evaluator of EVALUATORS) {
      if (shouldYieldNow(ctx, shouldYield)) break;
      const action = evaluator.evaluate(ctx);
      if (action.type === "done") {
        ctx.debug("lifecycle.eval.decision", { evaluator: evaluator.id, action: "done" });
        continue;
      }

      if (ctx.regenerationCount >= ctx.policy.maxRegenerationsPerRequest) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "regeneration_cap",
          regeneration_count: ctx.regenerationCount,
          regeneration_cap: ctx.policy.maxRegenerationsPerRequest,
        });
        continue;
      }

      const saved = action.keepResult ? snapshotState(ctx) : undefined;
      if (action.mode) setMode(ctx, action.mode, evaluator.id);

      ctx.regenerationCount += 1;
      ctx.debug("lifecycle.eval.decision", {
        evaluator: evaluator.id,
        action: "regenerate",
        mode: ctx.mode,
        cycle_limit: action.cycleLimit ?? ctx.policy.initialMaxSteps,
        keep_result: Boolean(action.keepResult),
        regeneration_count: ctx.regenerationCount,
      });

      await phaseGenerate(ctx, action.prompt, {
        cycleLimit: action.cycleLimit ?? ctx.policy.initialMaxSteps,
        timeoutMs: ctx.policy.stepTimeoutMs,
      });
      if (shouldYieldNow(ctx, shouldYield)) break;

      if (saved) restoreState(ctx, saved);
      regenerated = true;
      break;
    }
    if (!regenerated) break;
  }
}
