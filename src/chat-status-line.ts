/**
 * Session token totals for the status line: committed per-turn usage plus the
 * in-flight `runningUsage` so the counts climb live during a turn. The message
 * handler clears `runningUsage` in the same synchronous batch that commits the
 * finished turn's entry, so no render double-counts a turn (chat-message-handler.ts).
 */
export function statusTokenTotals(
  committed: readonly { usage: { inputTokens: number; outputTokens: number } }[],
  running: { inputTokens: number; outputTokens: number } | null,
): { inputTokens: number; outputTokens: number } {
  let inputTokens = running?.inputTokens ?? 0;
  let outputTokens = running?.outputTokens ?? 0;
  for (const entry of committed) {
    inputTokens += entry.usage.inputTokens;
    outputTokens += entry.usage.outputTokens;
  }
  return { inputTokens, outputTokens };
}
