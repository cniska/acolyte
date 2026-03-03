import { toolMeta } from "./mastra-tools";
import { formatToolLabel } from "./tool-labels";

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

const aliasMap = new Map<string, string>();
for (const [id, meta] of Object.entries(toolMeta)) {
  for (const alias of meta.aliases) {
    aliasMap.set(alias, id);
  }
}

export function canonicalToolId(value: string): string {
  const normalized = value.trim();
  return aliasMap.get(normalized) ?? normalized;
}

const TOOL_HEADER_PATHS_MAX_SHOWN = 3;
const TOOL_HEADER_LABEL_ONLY_TOOLS = new Set(["find-files", "search-files", "read-file", "git-status"]);
const TOOL_HEADER_PATH_DETAIL_TOOLS = new Set([
  "edit-file",
  "edit-code",
  "create-file",
  "delete-file",
  "git-diff",
  "git-log",
  "git-show",
  "scan-code",
]);

function compactProgressDetail(value: string, maxChars = 80): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) return single;
  return `${single.slice(0, maxChars - 1).trimEnd()}…`;
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed.length > 0 ? [trimmed] : [];
      }
      if (typeof entry === "object" && entry !== null && "path" in entry) {
        const p = (entry as { path: unknown }).path;
        if (typeof p === "string") {
          const trimmed = p.trim();
          return trimmed.length > 0 ? [trimmed] : [];
        }
      }
      return [];
    });
  }
  return [];
}

function collectPathDetails(args: Record<string, unknown>): string[] {
  const candidates = [args.path, args.paths, args.file, args.files]
    .flatMap((entry) => asStringList(entry))
    .map((entry) => compactProgressDetail(entry, 48));
  return Array.from(new Set(candidates));
}

function formatPathList(paths: string[], maxShown = TOOL_HEADER_PATHS_MAX_SHOWN): string | null {
  if (paths.length === 0) return null;
  const shown = paths.slice(0, maxShown).join(", ");
  if (paths.length <= maxShown) return shown;
  return `${shown} (+${paths.length - maxShown})`;
}

export function formatToolHeader(toolName: string, args: Record<string, unknown>): string {
  const label = formatToolLabel(toolName);
  const asString = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? compactProgressDetail(trimmed) : null;
  };

  if (toolName === "run-command") {
    const command = asString(args.command);
    return command ? `${label} ${command}` : label;
  }
  if (TOOL_HEADER_PATH_DETAIL_TOOLS.has(toolName)) {
    const paths = collectPathDetails(args);
    const formatted = formatPathList(paths);
    return formatted ? `${label} ${formatted}` : label;
  }
  if (TOOL_HEADER_LABEL_ONLY_TOOLS.has(toolName)) return label;
  if (toolName === "web-search") {
    const query = asString(args.query);
    return query ? `${label} "${query}"` : label;
  }
  if (toolName === "web-fetch") {
    const url = asString(args.url);
    return url ? `${label} ${url}` : label;
  }
  return label;
}

export function finalizeReviewOutput(output: string, message = ""): string {
  const trimmed = output.trim();
  if (trimmed.length > 0) return trimmed;
  const mentionedPath = extractMentionedPath(message);
  if (mentionedPath)
    return `No review output produced for @${mentionedPath}. Try narrowing the scope (for example ${suggestNarrowerReviewScope(mentionedPath)}) or rephrasing your prompt.`;
  return "No review output produced. Try narrowing to a file (for example @src/agent.ts) or rephrasing your prompt.";
}

export function finalizeAssistantOutput(
  output: string,
  message = "",
  toolCallCount = 0,
  lastToolFailureReason?: string,
): string {
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
  if (lastToolFailureReason) return `No output from model. Last tool error: ${lastToolFailureReason}`;
  return "No output from model. Check /status and server logs, then retry or switch model/provider.";
}
