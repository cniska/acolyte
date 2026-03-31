import { type RecoveryAction, recoveryActionForError as resolveRecoveryAction } from "./error-handling";
import { t } from "./i18n";
import type { Effect, LifecycleInput, RunContext } from "./lifecycle-contract";
import { formatEffect, lintEffect } from "./lifecycle-effects";
import { defaultLifecyclePolicy, type LifecyclePolicy } from "./lifecycle-policy";
import { acceptedLifecycleSignal } from "./lifecycle-state";

const EFFECTS: Effect[] = [formatEffect, lintEffect];

type PhaseSettleDeps = {
  effects: readonly Effect[];
};

const defaultPhaseSettleDeps: PhaseSettleDeps = {
  effects: EFFECTS,
};

export function recoveryActionForError(
  input: { errorCode?: string; unknownErrorCount: number },
  policy: LifecyclePolicy = defaultLifecyclePolicy,
): RecoveryAction {
  return resolveRecoveryAction(input, policy.maxUnknownErrorsPerRequest);
}

export async function phaseSettle(
  ctx: RunContext,
  shouldYield: LifecycleInput["shouldYield"],
  deps: PhaseSettleDeps = defaultPhaseSettleDeps,
) {
  if (!ctx.result) return;
  if (shouldYield?.()) return;

  const lifecycleSignal = acceptedLifecycleSignal(ctx);
  if (lifecycleSignal) {
    ctx.currentError = undefined;
    ctx.debug("lifecycle.signal.accepted", {
      signal: lifecycleSignal,
      tool_calls: ctx.result.toolCalls.length,
    });
  }

  if (
    recoveryActionForError({
      errorCode: ctx.currentError?.code,
      unknownErrorCount: ctx.errorStats.other,
    }) === "stop-unknown-budget"
  ) {
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
    return;
  }

  for (const effect of deps.effects) {
    if (shouldYield?.()) break;
    const result = effect.run(ctx);
    ctx.debug("lifecycle.eval.decision", { effect: effect.id, action: "done" });
    if (result.lintOutput) {
      ctx.debug("lifecycle.effect.lint.output", { output: result.lintOutput });
    }
  }
}
