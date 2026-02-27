import { runLifecycle } from "./agent-lifecycle";
import { type AgentMode, agentModes } from "./agent-modes";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import type { StreamEvent } from "./client";
import type { LifecycleDebugEvent } from "./lifecycle-events";
import { toolMeta } from "./mastra-tools";
import { isProviderAvailable, type ModelProviderName, providerFromModel } from "./provider-config";
import { formatToolLabel } from "./tool-labels";
import { isToolName } from "./tool-names";
import { detectLineWidth } from "./tools";

// --- Input shaping ---

const APPROX_CHARS_PER_TOKEN = 4;

export function estimateTokens(input: string): number {
  if (input.length === 0) return 0;
  return Math.ceil(input.length / APPROX_CHARS_PER_TOKEN);
}

function truncateByTokens(input: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isRelevantFileContext(content: string): boolean {
  return content.startsWith("Attached file:") || content.startsWith("Attached directory:");
}

function isPinnedSystemContext(content: string): boolean {
  return content.startsWith("Active skill (") || content.startsWith("Pinned memory:");
}

function lineForMessage(message: ChatRequest["history"][number], maxTokens: number): { line: string; tokens: number } {
  const compact = truncateByTokens(message.content, maxTokens);
  const line = `${message.role.toUpperCase()}: ${compact}`;
  return { line, tokens: estimateTokens(line) };
}

function collectLinesWithinBudget(
  messages: ChatRequest["history"],
  usedIds: Set<string>,
  remainingTokens: number,
  maxPerMessageTokens: number,
): { lines: string[]; consumedTokens: number } {
  const lines: string[] = [];
  let consumed = 0;
  const recent = messages.slice(-appConfig.agent.inputBudget.maxHistoryMessages);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const message = recent[i];
    if (usedIds.has(message.id)) continue;
    const candidate = lineForMessage(message, maxPerMessageTokens);
    if (candidate.tokens === 0 || consumed + candidate.tokens > remainingTokens) continue;
    usedIds.add(message.id);
    lines.unshift(candidate.line);
    consumed += candidate.tokens;
  }
  return { lines, consumedTokens: consumed };
}

export function createAgentInput(req: ChatRequest): {
  input: string;
  usage: {
    promptTokens: number;
    promptBudgetTokens: number;
    promptTruncated: boolean;
    includedHistoryMessages: number;
    totalHistoryMessages: number;
  };
} {
  const maxContextTokens = appConfig.agent.contextMaxTokens;
  const lines: string[] = [];
  const usedIds = new Set<string>();
  const budget = appConfig.agent.inputBudget;

  const userLine = `USER: ${truncateByTokens(req.message.trim(), budget.maxMessageTokens)}`;
  const userTokens = estimateTokens(userLine);
  let remaining = Math.max(0, maxContextTokens - userTokens);

  const pinnedSystem = req.history.filter(
    (message) => message.role === "system" && isPinnedSystemContext(message.content),
  );
  const pinnedResult = collectLinesWithinBudget(pinnedSystem, usedIds, remaining, budget.maxPinnedMessageTokens);
  lines.push(...pinnedResult.lines);
  remaining -= pinnedResult.consumedTokens;

  const relevantFiles = req.history.filter(
    (message) => message.role === "system" && isRelevantFileContext(message.content),
  );
  const filesResult = collectLinesWithinBudget(relevantFiles, usedIds, remaining, budget.maxAttachmentMessageTokens);
  lines.push(...filesResult.lines);
  remaining -= filesResult.consumedTokens;

  const recentResult = collectLinesWithinBudget(req.history, usedIds, remaining, budget.maxMessageTokens);
  lines.push(...recentResult.lines);

  if (lines.length > 0) lines.push("");
  lines.push(userLine);
  const input = lines.join("\n");
  const promptTokens = estimateTokens(input);
  return {
    input,
    usage: {
      promptTokens,
      promptBudgetTokens: maxContextTokens,
      promptTruncated: usedIds.size < req.history.length,
      includedHistoryMessages: usedIds.size,
      totalHistoryMessages: req.history.length,
    },
  };
}

// --- Output heuristics ---

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

export function createSubagentContext(req: ChatRequest): string {
  const scope = req.history.length > 0 ? `${req.history.length} history messages` : "no history";
  return ["Agent: Acolyte", `Goal: ${req.message.trim()}`, `Context: ${scope}; model=${req.model}`].join("\n");
}

// --- Instructions ---

const BASE_INSTRUCTIONS = [
  "- Act, don't narrate. Use tools directly — do not describe what you will do.",
  "- Prefer dedicated tools over shell equivalents.",
  "- Do not use shell fallbacks for file read/search/edit when dedicated tools exist.",
  "- Stop once evidence is decisive; do not keep searching for completeness.",
  "- Keep working until done. Make reasonable assumptions instead of asking — only ask if truly stuck with no viable path.",
].join("\n");

export function createModeInstructions(mode: AgentMode, workspace?: string): string {
  const { tools, preamble } = agentModes[mode];
  const lines: string[] = preamble.map((p) => `- ${p}`);
  for (const toolId of tools) {
    if (!isToolName(toolId)) continue;
    const meta = toolMeta[toolId];
    if (meta?.instruction) lines.push(`- ${meta.instruction}`);
  }
  if (workspace && mode === "work") {
    const lineWidth = detectLineWidth(workspace);
    if (lineWidth) lines.push(`- Keep lines under ${lineWidth} characters.`);
  }
  return lines.join("\n");
}

export function createInstructions(baseInstructions: string, mode: AgentMode, workspace?: string): string {
  const modeInstructions = createModeInstructions(mode, workspace);
  return `${baseInstructions}\n\n${BASE_INSTRUCTIONS}\n\n${modeInstructions}`;
}

// --- Model resolution ---

export function resolveModelProviderState(
  model: string,
  credentials: {
    openaiApiKey?: string;
    openaiBaseUrl: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
  } = {
    openaiApiKey: appConfig.openai.apiKey,
    openaiBaseUrl: appConfig.openai.baseUrl,
    anthropicApiKey: appConfig.anthropic.apiKey,
    googleApiKey: appConfig.google.apiKey,
  },
): { provider: ModelProviderName; available: boolean } {
  const provider = providerFromModel(model);
  const available = isProviderAvailable({
    provider,
    openaiApiKey: credentials.openaiApiKey,
    openaiBaseUrl: credentials.openaiBaseUrl,
    anthropicApiKey: credentials.anthropicApiKey,
    googleApiKey: credentials.googleApiKey,
  });
  return { provider, available };
}

export function resolveRunnableModel(
  requestedModel: string,
  credentials?: {
    openaiApiKey?: string;
    openaiBaseUrl: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
  },
): {
  model: string;
  provider: ModelProviderName;
  available: boolean;
} {
  const state = resolveModelProviderState(requestedModel, credentials);
  return {
    model: requestedModel,
    provider: state.provider,
    available: state.available,
  };
}

// --- Tool output formatting ---

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

function formatPathList(paths: string[], maxShown = 3): string | null {
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

  switch (toolName) {
    case "run-command": {
      const command = asString(args.command);
      return command ? `${label} ${command}` : label;
    }
    case "read-file":
    case "edit-file":
    case "edit-code":
    case "create-file":
    case "delete-file":
    case "git-diff": {
      const paths = collectPathDetails(args);
      const formatted = formatPathList(paths);
      return formatted ? `${label} ${formatted}` : label;
    }
    case "find-files":
    case "search-files": {
      const pattern = asString(args.pattern);
      return pattern ? `${label} ${pattern}` : label;
    }
    case "scan-code": {
      const paths = collectPathDetails(args);
      const formatted = formatPathList(paths);
      const pattern = asString(args.pattern);
      const detail = [formatted, pattern].filter(Boolean).join(" ");
      return detail ? `${label} ${detail}` : label;
    }
    case "git-status":
      return `${label} .`;
    case "web-search": {
      const query = asString(args.query);
      return query ? `${label} ${query}` : label;
    }
    case "web-fetch": {
      const url = asString(args.url);
      return url ? `${label} ${url}` : label;
    }
    default:
      return label;
  }
}

// --- Finalization ---

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
  void message;
  const trimmed = output.trim();
  if (trimmed.length > 0) return trimmed;
  if (toolCallCount > 0) return "No final response after tool execution. Retry, or check server logs if this repeats.";
  if (lastToolFailureReason) return `No output from model. Last tool error: ${lastToolFailureReason}`;
  return "No output from model. Check /status and server logs, then retry or switch model/provider.";
}

// --- Entrypoint ---

export async function runAgent(input: {
  request: ChatRequest;
  soulPrompt: string;
  workspace?: string;
  onEvent?: (event: StreamEvent) => void;
  onDebug?: (event: LifecycleDebugEvent) => void;
}): Promise<ChatResponse> {
  return runLifecycle(input);
}
