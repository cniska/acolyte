import {
  INITIAL_MAX_STEPS,
  MAX_EVALUATOR_CHAIN_REGENERATIONS,
  MAX_REGENERATIONS_PER_EVALUATOR,
  MAX_REGENERATIONS_PER_REQUEST,
  MAX_UNKNOWN_ERRORS_PER_REQUEST,
  STEP_TIMEOUT_MS,
} from "./lifecycle-constants";
import {
  autoVerifier,
  efficiencyEvaluator,
  multiMatchEditEvaluator,
  planDetector,
  timeoutRecovery,
  type Evaluator,
  verifyFailure,
} from "./lifecycle-evaluators";
import { phaseGenerate, shouldYieldNow } from "./lifecycle-generate";
import type { LifecycleInput, RunContext, SavedRegenerationState } from "./lifecycle-contract";
import { type RecoveryAction, recoveryActionForError as resolveRecoveryAction } from "./error-handling";

const EVALUATORS: Evaluator[] = [
  planDetector,
  multiMatchEditEvaluator,
  efficiencyEvaluator,
  timeoutRecovery,
  autoVerifier,
  verifyFailure,
];

export function recoveryActionForError(input: { errorCode?: string; unknownErrorCount: number }): RecoveryAction {
  return resolveRecoveryAction(input, MAX_UNKNOWN_ERRORS_PER_REQUEST);
}

export async function phaseEvaluate(ctx: RunContext, shouldYield: LifecycleInput["shouldYield"]) {
  const regenByEvaluator = new Map<string, number>();
  let evaluatorChainRegenerations = 0;

  while (ctx.result) {
    if (shouldYieldNow(ctx, shouldYield)) break;

    if (
      recoveryActionForError({
        errorCode: ctx.lastErrorCode,
        unknownErrorCount: ctx.errorStats.other,
      }) === "stop-unknown-budget"
    ) {
      ctx.regenerationLimitHit = true;
      ctx.debug("lifecycle.eval.skipped", {
        reason: "unknown_error_budget",
        unknown_error_count: ctx.errorStats.other,
        unknown_error_cap: MAX_UNKNOWN_ERRORS_PER_REQUEST,
        last_error_code: ctx.lastErrorCode ?? null,
      });
      if (!ctx.result.text.trim()) {
        ctx.result = {
          text: "Stopped after repeated unknown errors. Narrow the task scope or inspect lifecycle traces and retry.",
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

      const evaluatorRegens = regenByEvaluator.get(evaluator.id) ?? 0;
      if (evaluatorChainRegenerations >= MAX_EVALUATOR_CHAIN_REGENERATIONS) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "chain_cap",
          chain_regenerations: evaluatorChainRegenerations,
          chain_cap: MAX_EVALUATOR_CHAIN_REGENERATIONS,
        });
        continue;
      }
      if (ctx.regenerationCount >= MAX_REGENERATIONS_PER_REQUEST) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "request_cap",
          regeneration_count: ctx.regenerationCount,
          regeneration_cap: MAX_REGENERATIONS_PER_REQUEST,
        });
        continue;
      }
      if (evaluatorRegens >= MAX_REGENERATIONS_PER_EVALUATOR) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "evaluator_cap",
          evaluator_regenerations: evaluatorRegens,
          evaluator_cap: MAX_REGENERATIONS_PER_EVALUATOR,
        });
        continue;
      }

      const saved: SavedRegenerationState | undefined = action.keepResult
        ? {
            result: ctx.result,
            lastError: ctx.lastError,
            lastErrorCode: ctx.lastErrorCode,
            lastErrorCategory: ctx.lastErrorCategory,
            lastErrorSource: ctx.lastErrorSource,
            lastErrorTool: ctx.lastErrorTool,
          }
        : undefined;
      if (action.mode) ctx.mode = action.mode;

      ctx.regenerationCount += 1;
      evaluatorChainRegenerations += 1;
      regenByEvaluator.set(evaluator.id, evaluatorRegens + 1);
      ctx.debug("lifecycle.eval.decision", {
        evaluator: evaluator.id,
        action: "regenerate",
        mode: ctx.mode,
        max_steps: action.maxSteps ?? INITIAL_MAX_STEPS,
        timeout_ms: action.timeoutMs ?? STEP_TIMEOUT_MS,
        keep_result: Boolean(action.keepResult),
        regeneration_count: ctx.regenerationCount,
        evaluator_regenerations: evaluatorRegens + 1,
      });

      await phaseGenerate(ctx, action.prompt, {
        maxSteps: action.maxSteps ?? INITIAL_MAX_STEPS,
        timeoutMs: action.timeoutMs ?? STEP_TIMEOUT_MS,
      });
      if (shouldYieldNow(ctx, shouldYield)) break;

      if (saved) {
        ctx.result = saved.result;
        ctx.lastError = saved.lastError;
        ctx.lastErrorCode = saved.lastErrorCode;
        ctx.lastErrorCategory = saved.lastErrorCategory;
        ctx.lastErrorSource = saved.lastErrorSource;
        ctx.lastErrorTool = saved.lastErrorTool;
      }
      regenerated = true;
      break;
    }
    if (!regenerated) break;
  }
}
