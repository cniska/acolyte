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
