import { createAgent } from "./agent-factory";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import { toolsForAgent } from "./mastra-tools";
import { isProviderAvailable, type ModelProviderName, providerFromModel } from "./provider-config";
import { formatToolLabel } from "./tool-labels";

export type AgentRole = "coder";

const FALLBACK_PLAN =
  "1) Interpret request. 2) Use available repo tools when helpful. 3) Return concise, actionable answer.";
const APPROX_CHARS_PER_TOKEN = 4;

function estimateTokens(input: string): number {
  if (input.length === 0) {
    return 0;
  }
  return Math.ceil(input.length / APPROX_CHARS_PER_TOKEN);
}

function truncateByTokens(input: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  if (input.length <= maxChars) {
    return input;
  }
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
    if (usedIds.has(message.id)) {
      continue;
    }
    const candidate = lineForMessage(message, maxPerMessageTokens);
    if (candidate.tokens === 0 || consumed + candidate.tokens > remainingTokens) {
      continue;
    }
    usedIds.add(message.id);
    lines.unshift(candidate.line);
    consumed += candidate.tokens;
  }
  return { lines, consumedTokens: consumed };
}

export function buildAgentInput(req: ChatRequest): string {
  return buildAgentInputWithUsage(req).input;
}

function buildAgentInputWithUsage(req: ChatRequest): {
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

  if (lines.length > 0) {
    lines.push("");
  }
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

function isToolLikelyRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const hints = [
    "add",
    "change",
    "update",
    "remove",
    "delete",
    "insert",
    "line break",
    "newline",
    "search",
    "read",
    "file",
    "diff",
    "git",
    "status",
    "run",
    "command",
    "edit",
    "refactor",
    "find",
    "where",
    "typecheck",
    "lint",
    "test",
  ];
  return hints.some((hint) => lower.includes(hint));
}

export function isPlanLikeOutput(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return false;
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }
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

function isReviewRequest(text: string): boolean {
  return /\breview\b/i.test(text);
}

export function selectAgentRole(_text: string): AgentRole {
  return "coder";
}

export function buildSubagentContext(_role: AgentRole, req: ChatRequest): string {
  const scope = req.history.length > 0 ? `${req.history.length} history messages` : "no history";
  return ["Agent: Acolyte", `Goal: ${req.message.trim()}`, `Context: ${scope}; model=${req.model}`].join("\n");
}

export function buildRoleInstructions(baseInstructions: string, _role: AgentRole): string {
  const executionContract = [
    "Execution contract:",
    "- Prefer tool-backed execution over speculative answers when code changes are requested.",
    "- When a task is straightforward, execute it directly; do not ask for confirmation before editing.",
    "- Ask follow-up questions only when requirements are ambiguous, risky, or blocked by missing access/context.",
    "- For multi-step tasks, keep an internal checklist and do not finish until all requested items are addressed.",
    "- Respect response-shape constraints exactly (for example: 'summary only' means summary only).",
    "- Run verification only when explicitly requested, when required by repo policy, or when safety risk is high.",
    "- If verification is skipped, do not add extra verification commentary unless user asked for it.",
    "- Keep final output concise and outcome-focused.",
  ].join("\n");
  return `${baseInstructions}\n\n${executionContract}`;
}

export function resolveAgentModel(_role: AgentRole, requestedModel: string, _overrides?: unknown): string {
  return requestedModel;
}

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
  role: AgentRole,
  requestedModel: string,
  options: {
    overrides?: unknown;
    credentials?: {
      openaiApiKey?: string;
      openaiBaseUrl: string;
      anthropicApiKey?: string;
      googleApiKey?: string;
    };
  } = {},
): {
  model: string;
  provider: ModelProviderName;
  available: boolean;
  usedFallback: boolean;
} {
  const preferredModel = resolveAgentModel(role, requestedModel, options.overrides);
  const preferredState = resolveModelProviderState(preferredModel, options.credentials);
  if (preferredState.available || preferredModel === requestedModel) {
    return {
      model: preferredModel,
      provider: preferredState.provider,
      available: preferredState.available,
      usedFallback: false,
    };
  }

  const requestedState = resolveModelProviderState(requestedModel, options.credentials);
  if (requestedState.available) {
    return {
      model: requestedModel,
      provider: requestedState.provider,
      available: true,
      usedFallback: true,
    };
  }

  return {
    model: preferredModel,
    provider: preferredState.provider,
    available: false,
    usedFallback: false,
  };
}

function extractMentionedPath(message: string): string | null {
  const match = message.match(/@([^\s]+)/);
  if (!match) {
    return null;
  }
  const cleaned = (match[1] ?? "").replace(/[.,;:!?]+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function suggestNarrowerReviewScope(path: string): string {
  const clean = path.replace(/\/+$/, "");
  if (clean.length === 0) {
    return "@src/agent.ts";
  }
  if (clean.endsWith(".ts") || clean.endsWith(".tsx") || clean.endsWith(".js") || clean.endsWith(".md")) {
    return `@${clean}`;
  }
  return `@${clean}/agent.ts`;
}

export function canonicalToolId(value: string): string {
  const normalized = value.trim();
  const aliases: Record<string, string> = {
    readFile: "read-file",
    read_file: "read-file",
    searchRepo: "search-repo",
    search_repo: "search-repo",
    editFile: "edit-file",
    edit_file: "edit-file",
    gitDiff: "git-diff",
    git_diff: "git-diff",
    gitStatus: "git-status",
    git_status: "git-status",
    runCommand: "run-command",
    run_command: "run-command",
    execute_command: "run-command",
    webSearch: "web-search",
    web_search: "web-search",
    webFetch: "web-fetch",
    web_fetch: "web-fetch",
  };
  return aliases[normalized] ?? normalized;
}

function collectToolCallIds(toolCalls: unknown[]): string[] {
  const names = toolCalls
    .map((call) => {
      if (typeof call === "string") {
        const trimmed = call.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (!call || typeof call !== "object") {
        return null;
      }
      const payload =
        "payload" in (call as Record<string, unknown>) &&
        (call as { payload?: unknown }).payload &&
        typeof (call as { payload?: unknown }).payload === "object"
          ? ((call as { payload?: unknown }).payload as Record<string, unknown>)
          : null;
      const candidate =
        (call as { toolName?: unknown }).toolName ??
        (call as { name?: unknown }).name ??
        (call as { id?: unknown }).id ??
        payload?.toolName ??
        payload?.name ??
        payload?.id;
      return typeof candidate === "string" ? canonicalToolId(candidate) : null;
    })
    .filter((name): name is string => Boolean(name))
    .slice(0, 10);
  return Array.from(new Set(names));
}

function normalizeToolCalls(rawToolCalls: unknown): unknown[] {
  if (Array.isArray(rawToolCalls)) {
    return rawToolCalls;
  }
  if (!rawToolCalls || typeof rawToolCalls !== "object") {
    return [];
  }
  if (Symbol.iterator in rawToolCalls && typeof (rawToolCalls as Iterable<unknown>)[Symbol.iterator] === "function") {
    return Array.from(rawToolCalls as Iterable<unknown>);
  }
  return [];
}

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function compactProgressDetail(value: string, maxChars = 80): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= maxChars) {
    return single;
  }
  return `${single.slice(0, maxChars - 1).trimEnd()}…`;
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => entry.length > 0);
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
  if (paths.length === 0) {
    return null;
  }
  const shown = paths.slice(0, maxShown).join(", ");
  if (paths.length <= maxShown) {
    return shown;
  }
  return `${shown} (+${paths.length - maxShown})`;
}

type DiffLinePreview = {
  kind: "add" | "del" | "ctx";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

type UnifiedDiffFile = {
  path: string;
  added: number;
  removed: number;
  preview: DiffLinePreview[];
  previewOverflow: number;
};

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = line.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
  if (!match) {
    return null;
  }
  const oldStart = Number.parseInt(match[1] ?? "", 10);
  const newStart = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(oldStart) || !Number.isFinite(newStart)) {
    return null;
  }
  return { oldStart, newStart };
}

function parseUnifiedDiffFiles(text: string, maxPreviewLinesPerFile = 8): UnifiedDiffFile[] {
  if (!text.includes("diff --git")) {
    return [];
  }
  const lines = text.split("\n");
  const summaries: UnifiedDiffFile[] = [];
  let current: UnifiedDiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of lines) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch) {
      if (current) {
        summaries.push(current);
      }
      current = {
        path: (diffMatch[2] ?? diffMatch[1] ?? "").trim(),
        added: 0,
        removed: 0,
        preview: [],
        previewOverflow: 0,
      };
      oldLine = 0;
      newLine = 0;
      continue;
    }
    if (!current || line.length === 0) {
      continue;
    }
    const hunk = parseHunkHeader(line);
    if (hunk) {
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }
    if (line.startsWith(" ")) {
      if (current.preview.length < maxPreviewLinesPerFile) {
        current.preview.push({
          kind: "ctx",
          oldLine,
          newLine,
          text: line.slice(1),
        });
      } else {
        current.previewOverflow += 1;
      }
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (line.startsWith("+")) {
      current.added += 1;
      if (current.preview.length < maxPreviewLinesPerFile) {
        current.preview.push({
          kind: "add",
          oldLine: null,
          newLine,
          text: line.slice(1),
        });
      } else {
        current.previewOverflow += 1;
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      current.removed += 1;
      if (current.preview.length < maxPreviewLinesPerFile) {
        current.preview.push({
          kind: "del",
          oldLine,
          newLine: null,
          text: line.slice(1),
        });
      } else {
        current.previewOverflow += 1;
      }
      oldLine += 1;
    }
  }
  if (current) {
    summaries.push(current);
  }
  return summaries.filter((entry) => entry.path.length > 0);
}

export function formatToolProgressMessage(toolName: string, args: Record<string, unknown>): string {
  const label = formatToolLabel(toolName);
  const asString = (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }
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
    case "git-diff": {
      const paths = collectPathDetails(args);
      const formatted = formatPathList(paths);
      return formatted ? `${label} ${formatted}` : label;
    }
    case "search-repo": {
      const pattern = asString(args.pattern);
      return pattern ? `${label} ${pattern}` : label;
    }
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

function parseToolResultText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (!raw || typeof raw !== "object") {
    return "";
  }
  const entry = raw as {
    output?: unknown;
    result?: unknown;
    text?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    error?: unknown;
    message?: unknown;
  };
  const errorText =
    typeof entry.error === "string"
      ? entry.error
      : entry.error && typeof entry.error === "object" && "message" in (entry.error as Record<string, unknown>)
        ? String((entry.error as Record<string, unknown>).message ?? "")
        : "";
  const chunks = [entry.output, entry.result, entry.text, entry.stdout, entry.stderr, entry.message, errorText]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return chunks.join("\n");
}

function extractToolFailureReason(resultText: string): string | null {
  const trimmed = resultText.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const failureLine = lines.find((line) => /failed:|error[:\s]/i.test(line));
  if (failureLine) {
    return compactProgressDetail(failureLine.replace(/^error[:\s]*/i, ""), 140);
  }
  if (/permission|denied|disabled|forbidden|not found|quota/i.test(trimmed)) {
    return compactProgressDetail(lines[0] ?? trimmed, 140);
  }
  return null;
}

function formatToolResultProgressMessages(toolName: string, resultText: string): string[] {
  if (!resultText.trim()) {
    return [];
  }
  if (toolName !== "edit-file") {
    return [];
  }
  const files = parseUnifiedDiffFiles(resultText, 4);
  if (files.length === 0) {
    return [];
  }
  const lines: string[] = [];
  const verb = formatToolLabel(toolName);
  for (const file of files) {
    lines.push(`${verb} ${compactProgressDetail(file.path, 48)} (+${file.added} -${file.removed})`);
    for (const preview of file.preview) {
      if (preview.kind === "del") {
        lines.push(`${preview.oldLine ?? "?"} - ${compactProgressDetail(preview.text, 96)}`);
      } else if (preview.kind === "add") {
        lines.push(`${preview.newLine ?? "?"} + ${compactProgressDetail(preview.text, 96)}`);
      } else {
        lines.push(`${preview.newLine ?? preview.oldLine ?? "?"}   ${compactProgressDetail(preview.text, 96)}`);
      }
    }
    if (file.previewOverflow > 0) {
      lines.push(`… +${file.previewOverflow} more changed lines`);
    }
  }
  return lines;
}

export function collectToolProgressFromStep(
  step: unknown,
): Array<{ name: string; args: Record<string, unknown>; result: string }> {
  if (!step || typeof step !== "object") {
    return [];
  }
  const containers: Array<{
    toolCalls?: unknown;
    tool_calls?: unknown;
    toolResults?: unknown;
    tool_results?: unknown;
  }> = [];
  const queue: unknown[] = [step];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const obj = current as Record<string, unknown>;
    if ("toolCalls" in obj || "tool_calls" in obj || "toolResults" in obj || "tool_results" in obj) {
      containers.push(obj);
    }
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") {
            queue.push(item);
          }
        }
        continue;
      }
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  const progress: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
  for (const container of containers) {
    const rawCalls =
      (Array.isArray(container.toolCalls) && container.toolCalls) ||
      (Array.isArray(container.tool_calls) && container.tool_calls) ||
      [];
    for (const call of rawCalls as unknown[]) {
      if (!call || typeof call !== "object") {
        continue;
      }
      const entry = call as {
        toolName?: unknown;
        name?: unknown;
        id?: unknown;
        args?: unknown;
        input?: unknown;
        parameters?: unknown;
      };
      const name = [entry.toolName, entry.name, entry.id].find((value) => typeof value === "string") as
        | string
        | undefined;
      if (!name) {
        continue;
      }
      const args = parseToolArgs(entry.args ?? entry.input ?? entry.parameters);
      progress.push({ name, args, result: "" });
    }
    const rawResults =
      (Array.isArray(container.toolResults) && container.toolResults) ||
      (Array.isArray(container.tool_results) && container.tool_results) ||
      [];
    for (const result of rawResults as unknown[]) {
      if (!result || typeof result !== "object") {
        continue;
      }
      const entry = result as {
        toolName?: unknown;
        name?: unknown;
        id?: unknown;
        args?: unknown;
        input?: unknown;
        parameters?: unknown;
        output?: unknown;
        result?: unknown;
        text?: unknown;
        stdout?: unknown;
      };
      const name = [entry.toolName, entry.name, entry.id].find((value) => typeof value === "string") as
        | string
        | undefined;
      if (!name) {
        continue;
      }
      const args = parseToolArgs(entry.args ?? entry.input ?? entry.parameters);
      progress.push({ name, args, result: parseToolResultText(entry) });
    }
  }
  return progress;
}

export function finalizeReviewOutput(output: string, message = ""): string {
  const trimmed = output.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  const mentionedPath = extractMentionedPath(message);
  if (mentionedPath) {
    return `No review output produced for @${mentionedPath}. Try narrowing the scope (for example ${suggestNarrowerReviewScope(mentionedPath)}) or rephrasing your prompt.`;
  }
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
  if (trimmed.length > 0) {
    return trimmed;
  }
  if (toolCallCount > 0) {
    return "No final response after tool execution. Retry, or check backend logs if this repeats.";
  }
  if (lastToolFailureReason) {
    return `No output from model. Last tool error: ${lastToolFailureReason}`;
  }
  return "No output from model. Check /status and backend logs, then retry or switch model/provider.";
}

function buildMockReply(req: ChatRequest, reason?: string): ChatResponse {
  return {
    model: req.model,
    output: [
      "Remote backend is active.",
      reason ?? "Provider credentials are unavailable for the requested model, so mock mode is enabled.",
      `Plan: ${FALLBACK_PLAN}`,
      `Echo: ${req.message.trim()}`,
    ].join(" "),
    modelCalls: 0,
  };
}

export async function runAgent(input: {
  request: ChatRequest;
  soulPrompt: string;
  onProgress?: (message: string) => void;
  onDebug?: (event: string, fields?: Record<string, unknown>) => void;
}): Promise<ChatResponse> {
  const CODER_INITIAL_MAX_STEPS = 20;
  const REQUIRED_TOOLS_RETRY_MAX_STEPS = 6;
  const BASE_MODEL_RETRY_MAX_STEPS = 5;
  const EMPTY_TEXT_RETRY_MAX_STEPS = 4;
  const CODER_TIMEOUT_MS = 90_000;
  const role = selectAgentRole(input.request.message);
  const emitDebug = (event: string, fields: Record<string, unknown> = {}): void => {
    input.onDebug?.(event, {
      role,
      ...fields,
    });
  };
  emitDebug("agent.role.selected", { model_requested: input.request.model });
  const resolved = resolveRunnableModel(role, input.request.model);
  if (!resolved.available) {
    return buildMockReply(input.request, `Provider '${resolved.provider}' is not configured.`);
  }
  let model = resolved.model;
  let modelCallCount = 0;

  const buildRoleAgent = (agentModel: string) =>
    createAgent({
      id: `acolyte-${role}`,
      name: `Acolyte ${role[0].toUpperCase()}${role.slice(1)}`,
      model: agentModel,
      instructions: buildRoleInstructions(input.soulPrompt, role),
      tools: toolsForAgent(),
    });

  let agent = buildRoleAgent(model);
  const generateWithTimeout = async (
    prompt: string,
    options: {
      maxSteps: number;
      toolChoice: "auto" | "required";
      memory: { thread: string; resource: string } | undefined;
      onStepFinish: ((step: unknown) => void) | undefined;
    },
    timeoutMs: number,
  ) =>
    await new Promise<Awaited<ReturnType<typeof agent.generate>>>((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(`Model call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      agent
        .generate(prompt, options)
        .then((value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          resolve(value);
        })
        .catch((error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        });
    });

  const requestInput = buildAgentInputWithUsage(input.request);
  const subagentContext = buildSubagentContext(role, input.request);
  const agentInput = `${subagentContext}\n\n${requestInput.input}`;
  const toolLikely = isToolLikelyRequest(input.request.message);
  if (!toolLikely && input.request.model !== model) {
    const requestedState = resolveModelProviderState(input.request.model);
    if (requestedState.available) {
      model = input.request.model;
      agent = buildRoleAgent(model);
      emitDebug("agent.model.override", {
        reason: "coder_non_tool_prefers_requested_model",
        model,
      });
    }
  }
  const resourceId = input.request.resourceId?.trim() || appConfig.memory.resourceId;
  const memoryOptions = input.request.sessionId ? { thread: input.request.sessionId, resource: resourceId } : undefined;
  emitDebug("agent.context.built", {
    model_selected: model,
    history_messages: input.request.history.length,
    tool_likely: toolLikely,
    has_memory: Boolean(memoryOptions),
  });
  const seenToolNames = new Set<string>();
  const observedToolCallIds = new Set<string>();
  let lastToolFailureReason: string | undefined;
  const emitProgress = (message: string): void => {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return;
    }
    input.onProgress?.(trimmed);
  };
  const emitToolProgress = (step: unknown): void => {
    const tools = collectToolProgressFromStep(step);
    for (const tool of tools) {
      const toolId = canonicalToolId(tool.name);
      observedToolCallIds.add(toolId);
      const startMessage = formatToolProgressMessage(tool.name, tool.args);
      const startDedupeKey = JSON.stringify({ kind: "call", name: tool.name, message: startMessage });
      if (!seenToolNames.has(startDedupeKey)) {
        seenToolNames.add(startDedupeKey);
        emitProgress(startMessage);
      }
      const resultMessages = formatToolResultProgressMessages(tool.name, tool.result);
      const failureReason = extractToolFailureReason(tool.result);
      if (failureReason) {
        lastToolFailureReason = failureReason;
        emitDebug("agent.tool.failure", {
          tool_name: tool.name,
          reason: failureReason,
        });
        const failureMessage = `Tool failed: ${failureReason}`;
        const failureDedupeKey = JSON.stringify({ kind: "error", name: tool.name, message: failureMessage });
        if (!seenToolNames.has(failureDedupeKey)) {
          seenToolNames.add(failureDedupeKey);
          emitProgress(failureMessage);
        }
      }
      for (const resultMessage of resultMessages) {
        const resultDedupeKey = JSON.stringify({ kind: "result", name: tool.name, message: resultMessage });
        if (seenToolNames.has(resultDedupeKey)) {
          continue;
        }
        seenToolNames.add(resultDedupeKey);
        emitProgress(resultMessage);
      }
    }
  };

  const agentPrompt = agentInput;
  const initialMaxSteps = CODER_INITIAL_MAX_STEPS;
  const callTimeoutMs = CODER_TIMEOUT_MS;
  emitProgress("Working…");
  emitDebug("agent.generate.start", {
    model,
    tool_choice: "auto",
    max_steps: initialMaxSteps,
    reason: "initial",
  });
  let result: Awaited<ReturnType<typeof agent.generate>> | undefined;
  try {
    modelCallCount += 1;
    result = await generateWithTimeout(
      agentPrompt,
      {
        maxSteps: initialMaxSteps,
        toolChoice: "auto",
        memory: memoryOptions,
        onStepFinish: emitToolProgress,
      },
      callTimeoutMs,
    );
  } catch (error) {
    lastToolFailureReason = error instanceof Error ? error.message : String(error);
    emitDebug("agent.generate.retry_failed", {
      model,
      reason: "initial",
      error: lastToolFailureReason,
    });
    const output = finalizeAssistantOutput("", input.request.message, observedToolCallIds.size, lastToolFailureReason);
    const completionTokens = estimateTokens(output);
    return {
      model,
      output,
      toolCalls: Array.from(observedToolCallIds),
      modelCalls: modelCallCount,
      usage: {
        promptTokens: requestInput.usage.promptTokens,
        completionTokens,
        totalTokens: requestInput.usage.promptTokens + completionTokens,
        promptBudgetTokens: requestInput.usage.promptBudgetTokens,
        promptTruncated: requestInput.usage.promptTruncated,
      },
      budgetWarning: requestInput.usage.promptTruncated
        ? `context trimmed (${requestInput.usage.includedHistoryMessages}/${requestInput.usage.totalHistoryMessages} history messages)`
        : undefined,
    };
  }
  if (!result) {
    const output = finalizeAssistantOutput("", input.request.message, observedToolCallIds.size, lastToolFailureReason);
    const completionTokens = estimateTokens(output);
    return {
      model,
      output,
      toolCalls: Array.from(observedToolCallIds),
      modelCalls: modelCallCount,
      usage: {
        promptTokens: requestInput.usage.promptTokens,
        completionTokens,
        totalTokens: requestInput.usage.promptTokens + completionTokens,
        promptBudgetTokens: requestInput.usage.promptBudgetTokens,
        promptTruncated: requestInput.usage.promptTruncated,
      },
      budgetWarning: requestInput.usage.promptTruncated
        ? `context trimmed (${requestInput.usage.includedHistoryMessages}/${requestInput.usage.totalHistoryMessages} history messages)`
        : undefined,
    };
  }
  emitDebug("agent.generate.done", {
    model,
    reason: "initial",
    tool_calls: result.toolCalls.length,
    text_chars: result.text.trim().length,
  });

  const shouldRequireToolsFallback = false;
  if (shouldRequireToolsFallback && result.toolCalls.length === 0) {
    emitDebug("agent.generate.retry", {
      model,
      reason: "required_tools_no_calls",
      tool_choice: "required",
      max_steps: REQUIRED_TOOLS_RETRY_MAX_STEPS,
    });
    modelCallCount += 1;
    result = await generateWithTimeout(
      agentPrompt,
      {
        maxSteps: REQUIRED_TOOLS_RETRY_MAX_STEPS,
        toolChoice: "required",
        memory: memoryOptions,
        onStepFinish: emitToolProgress,
      },
      callTimeoutMs,
    );
    emitDebug("agent.generate.done", {
      model,
      reason: "required_tools_no_calls",
      tool_calls: result.toolCalls.length,
      text_chars: result.text.trim().length,
    });
  }

  const canRetryOnBaseModel = input.request.model !== model;
  if (shouldRequireToolsFallback && result.toolCalls.length === 0 && canRetryOnBaseModel) {
    const baseModelState = resolveModelProviderState(input.request.model);
    if (baseModelState.available) {
      model = input.request.model;
      agent = buildRoleAgent(model);
      emitDebug("agent.generate.retry", {
        model,
        reason: "switch_to_base_model",
        tool_choice: "required",
        max_steps: BASE_MODEL_RETRY_MAX_STEPS,
      });
      modelCallCount += 1;
      result = await generateWithTimeout(
        agentPrompt,
        {
          maxSteps: BASE_MODEL_RETRY_MAX_STEPS,
          toolChoice: "required",
          memory: memoryOptions,
          onStepFinish: emitToolProgress,
        },
        callTimeoutMs,
      );
      emitDebug("agent.generate.done", {
        model,
        reason: "switch_to_base_model",
        tool_calls: result.toolCalls.length,
        text_chars: result.text.trim().length,
      });
    }
  }

  let normalizedToolCalls = normalizeToolCalls(result.toolCalls);
  let toolCallIds = collectToolCallIds(normalizedToolCalls);
  const rawOutput = result.text.trim();
  if (normalizedToolCalls.length > 0 && toolCallIds.length === 0) {
    const first = normalizedToolCalls[0];
    const firstKeys = first && typeof first === "object" ? Object.keys(first as object).slice(0, 12) : [];
    emitDebug("agent.tool_calls.unparsed", {
      model,
      raw_tool_calls: normalizedToolCalls.length,
      first_keys: firstKeys.join(","),
      first_type: typeof first,
    });
  }
  if (result.text.trim().length === 0) {
    emitDebug("agent.generate.retry", {
      model,
      reason: "empty_text_response",
      tool_choice: "auto",
      max_steps: EMPTY_TEXT_RETRY_MAX_STEPS,
    });
    try {
      modelCallCount += 1;
      result = await generateWithTimeout(
        `${agentPrompt}\n\nReturn a direct concise answer.`,
        {
          maxSteps: EMPTY_TEXT_RETRY_MAX_STEPS,
          toolChoice: "auto",
          memory: memoryOptions,
          onStepFinish: emitToolProgress,
        },
        callTimeoutMs,
      );
      emitDebug("agent.generate.done", {
        model,
        reason: "empty_text_response",
        tool_calls: result.toolCalls.length,
        text_chars: result.text.trim().length,
      });
    } catch (error) {
      lastToolFailureReason = error instanceof Error ? error.message : String(error);
      emitDebug("agent.generate.retry_failed", {
        model,
        reason: "empty_text_response",
        error: lastToolFailureReason,
      });
    }
  }

  const output = isReviewRequest(input.request.message)
    ? finalizeReviewOutput(rawOutput, input.request.message)
    : finalizeAssistantOutput(rawOutput, input.request.message, toolCallIds.length, lastToolFailureReason);
  const completionTokens = estimateTokens(output);
  const promptUsage = requestInput.usage;
  let budgetWarning: string | undefined;
  if (promptUsage.promptTruncated) {
    budgetWarning = `context trimmed (${promptUsage.includedHistoryMessages}/${promptUsage.totalHistoryMessages} history messages)`;
  } else if (promptUsage.promptTokens >= Math.floor(promptUsage.promptBudgetTokens * 0.9)) {
    budgetWarning = `context near budget (${promptUsage.promptTokens}/${promptUsage.promptBudgetTokens} tokens)`;
  }

  return {
    model,
    output,
    toolCalls: toolCallIds,
    modelCalls: modelCallCount,
    usage: {
      promptTokens: promptUsage.promptTokens,
      completionTokens,
      totalTokens: promptUsage.promptTokens + completionTokens,
      promptBudgetTokens: promptUsage.promptBudgetTokens,
      promptTruncated: promptUsage.promptTruncated,
    },
    budgetWarning,
  };
}
