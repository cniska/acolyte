// Facts only — never prose. Each audience (model retry-nudge, user error row) renders
// its own text from these facts, so `currentError.message` stays user-audience by contract.
export type CompletionBlock = { reason: "empty-answer" };

export function findCompletionBlock(input: { finalText: string }): CompletionBlock | undefined {
  // A turn ends on a native no-tool-call step. An empty final response is not a completion —
  // the model ended its turn without writing anything for the user.
  if (input.finalText.trim().length === 0) return { reason: "empty-answer" };
  return undefined;
}
