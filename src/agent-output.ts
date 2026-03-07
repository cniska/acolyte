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

function extractMentionedPath(message: string): string | null {
  const match = message.match(/@([^\s]+)/);
  if (!match) return null;
  const cleaned = (match[1] ?? "").replace(/[.,;:!?]+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function suggestNarrowerReviewScope(path: string): string {
  const clean = path.replace(/\/+$/, "");
  if (clean.length === 0) return "@src/agent.ts";
  if (clean.endsWith(".ts") || clean.endsWith(".tsx") || clean.endsWith(".js") || clean.endsWith(".md"))
    return `@${clean}`;
  return `@${clean}/agent.ts`;
}

export function finalizeReviewOutput(output: string, message = ""): string {
  const trimmed = output.trim();
  if (trimmed.length > 0) return trimmed;
  const mentionedPath = extractMentionedPath(message);
  if (mentionedPath)
    return `No review output produced for @${mentionedPath}. Try narrowing the scope (for example ${suggestNarrowerReviewScope(mentionedPath)}) or rephrasing your prompt.`;
  return "No review output produced. Try narrowing to a file (for example @src/agent.ts) or rephrasing your prompt.";
}

export function finalizeAssistantOutput(output: string, message = "", toolCallCount = 0): string {
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
