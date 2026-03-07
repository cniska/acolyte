import { type RecoveryAction, recoveryActionForError as resolveRecoveryAction } from "./error-handling";
import type { LifecycleInput, RunContext, SavedRegenerationState } from "./lifecycle-contract";
import {
  autoVerifier,
  type Evaluator,
  multiMatchEditEvaluator,
  timeoutRecovery,
  verifyFailure,
} from "./lifecycle-evaluators";
import { phaseGenerate, shouldYieldNow } from "./lifecycle-generate";
import { defaultLifecyclePolicy, type LifecyclePolicy } from "./lifecycle-policy";

const EVALUATORS: Evaluator[] = [multiMatchEditEvaluator, timeoutRecovery, autoVerifier, verifyFailure];

function snapshotState(ctx: RunContext): SavedRegenerationState {
  return {
    result: ctx.result,
    lastError: ctx.lastError,
    lastErrorCode: ctx.lastErrorCode,
    lastErrorCategory: ctx.lastErrorCategory,
    lastErrorSource: ctx.lastErrorSource,
    lastErrorTool: ctx.lastErrorTool,
  };
}

function restoreState(ctx: RunContext, saved: SavedRegenerationState): void {
  ctx.result = saved.result;
  ctx.lastError = saved.lastError;
  ctx.lastErrorCode = saved.lastErrorCode;
  ctx.lastErrorCategory = saved.lastErrorCategory;
  ctx.lastErrorSource = saved.lastErrorSource;
  ctx.lastErrorTool = saved.lastErrorTool;
}

export function recoveryActionForError(
  input: { errorCode?: string; unknownErrorCount: number },
  policy: LifecyclePolicy = defaultLifecyclePolicy,
): RecoveryAction {
  return resolveRecoveryAction(input, policy.maxUnknownErrorsPerRequest);
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
        unknown_error_cap: ctx.policy.maxUnknownErrorsPerRequest,
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
      if (evaluatorChainRegenerations >= ctx.policy.maxEvaluatorChainRegenerations) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "chain_cap",
          chain_regenerations: evaluatorChainRegenerations,
          chain_cap: ctx.policy.maxEvaluatorChainRegenerations,
        });
        continue;
      }
      if (ctx.regenerationCount >= ctx.policy.maxRegenerationsPerRequest) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "request_cap",
          regeneration_count: ctx.regenerationCount,
          regeneration_cap: ctx.policy.maxRegenerationsPerRequest,
        });
        continue;
      }
      if (evaluatorRegens >= ctx.policy.maxRegenerationsPerEvaluator) {
        ctx.regenerationLimitHit = true;
        ctx.debug("lifecycle.eval.skipped", {
          evaluator: evaluator.id,
          reason: "evaluator_cap",
          evaluator_regenerations: evaluatorRegens,
          evaluator_cap: ctx.policy.maxRegenerationsPerEvaluator,
        });
        continue;
      }

      const saved = action.keepResult ? snapshotState(ctx) : undefined;
      if (action.mode) {
        ctx.mode = action.mode;
        ctx.session.mode = action.mode;
      }

      ctx.regenerationCount += 1;
      evaluatorChainRegenerations += 1;
      regenByEvaluator.set(evaluator.id, evaluatorRegens + 1);
      ctx.debug("lifecycle.eval.decision", {
        evaluator: evaluator.id,
        action: "regenerate",
        mode: ctx.mode,
        max_steps: action.maxSteps ?? ctx.policy.initialMaxSteps,
        timeout_ms: action.timeoutMs ?? ctx.policy.stepTimeoutMs,
        keep_result: Boolean(action.keepResult),
        regeneration_count: ctx.regenerationCount,
        evaluator_regenerations: evaluatorRegens + 1,
      });

      await phaseGenerate(ctx, action.prompt, {
        maxSteps: action.maxSteps ?? ctx.policy.initialMaxSteps,
        timeoutMs: action.timeoutMs ?? ctx.policy.stepTimeoutMs,
      });
      if (shouldYieldNow(ctx, shouldYield)) break;

      if (saved) restoreState(ctx, saved);
      regenerated = true;
      break;
    }
    if (!regenerated) break;
  }
}
