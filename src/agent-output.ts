export function isPlanLikeOutput(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) return false;
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return false;
  const planSignals = [
    /^plan\b/i,
    /^steps?\b/i,
    /^next steps?\b/i,
    /^i (can|will)\b/i,
    /^pick one\b/i,
    /^reply [a-z0-9]/i,
    /^want me to\b/i,
    /^(?:[-*•]\s*)?\d+[.)]\s+/,
  ];
  return lines.some((line) => planSignals.some((signal) => signal.test(line)));
}

export function formatAssistantOutput(output: string, message = "", toolCallCount = 0): string {
  const trimmed = output.trim();
  if (trimmed.length > 0) {
    const wantsDetail = /\b(explain|details?|deep dive|walk me through|elaborate)\b/i.test(message);
    const isVerbose = trimmed.length > 240 || trimmed.split("\n").filter((line) => line.trim().length > 0).length >= 4;
    if (toolCallCount > 0 && isVerbose && !wantsDetail) {
      const compact = trimmed
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^done\s*[—-]\s*/i, "");
      const firstSentence = compact.split(/(?<=[.!?])\s+/)[0] ?? compact;
      const sentence = firstSentence.length > 180 ? `${firstSentence.slice(0, 179).trimEnd()}…` : firstSentence;
      return sentence.length > 0 ? sentence : "Done.";
    }
    return trimmed;
  }
  if (toolCallCount > 0) return "No final response after tool execution. Retry, or check server logs if this repeats.";
  return "No output from model. Check /status and server logs, then retry or switch model/provider.";
}
