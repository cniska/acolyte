import type { RunContext } from "./lifecycle-contract";

export function clearVerifyOutcomeForFeedback(ctx: RunContext, feedbackSource?: string): void {
  if (feedbackSource === "verify") ctx.lifecycleState.verifyOutcome = undefined;
}

export function updateRepeatedFailureState(ctx: RunContext): void {
  const signature = failureSignatureForError(ctx);
  if (!signature) {
    ctx.lifecycleState.repeatedFailure = undefined;
    return;
  }

  const previous = ctx.lifecycleState.repeatedFailure;
  if (!previous || previous.signature !== signature) {
    ctx.lifecycleState.repeatedFailure = { signature, count: 1, status: "pending" };
    return;
  }

  ctx.lifecycleState.repeatedFailure = { ...previous, count: previous.count + 1 };
}

function failureSignatureForError(ctx: RunContext): string | undefined {
  if (!ctx.currentError) return undefined;
  const code = ctx.currentError.code ?? "unknown";
  const category = ctx.currentError.category ?? "other";
  const source = ctx.currentError.source ?? "generate";
  const tool = ctx.currentError.tool ?? "none";
  return [category, source, tool, code].join(":");
}
