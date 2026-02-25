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

export function createInstructions(baseInstructions: string): string {
  const executionContract = [
    "Execution contract:",
    "Tool Rules (use exact tool ids):",
    "- Use `read-file` and `search-repo` to inspect code, `edit-file` for file creation and updates, `delete-file` for deletions, and `run-command` for terminal commands.",
    "- Use `git-status`/`git-diff` for change inspection and `web-search`/`web-fetch` only when external lookup is needed.",
    "- Use tools for actions and text for communication.",
    "- Default to tool execution. If a task can be completed with available tools, do it with tools instead of providing instructions/code-only replies.",
    "- Read relevant files before editing; avoid speculative code changes.",
    "- Artifact requests (scripts/files/components/configs) MUST be fulfilled by creating or editing files directly in workspace.",
    "- For edit/update requests, check the target file with `read-file` first, then apply `edit-file`; do not guess file state.",
    "- Never claim a file was created/edited/found unless that is confirmed by tool results in the current turn.",
    "- For requests that create a new file, call `edit-file` with full file content directly (do not answer with file contents in chat).",
    "- If filename/path is not specified, choose a sensible default filename and create it (for example `sum.rs`) using `edit-file`.",
    "- Do not offer variants/options before performing a straightforward artifact request; create/edit the file first, then report outcome.",
    "- When asked to edit a specific file and it does not exist, state that the file is missing instead of silently creating a replacement file.",
    "- Forbidden: replying with 'save this as ...' or asking user to copy/paste file contents.",
    "",
    "Execution Loop:",
    "- Understand request and identify concrete target files/commands.",
    "- Implement changes directly with tools.",
    "- Verify when explicitly requested, when repo policy requires it, or when risk is high.",
    "- Keep working until requested changes are complete or a real blocker is hit.",
    "",
    "Completion + Communication:",
    "- For multi-step work, keep an internal checklist and do not finish until all requested items are addressed.",
    "- Ask follow-up questions only when requirements are ambiguous, risky, or blocked by missing access/context.",
    "- If a sensible default exists (for example filename), choose it and continue; avoid multi-question loops.",
    "- Execute directly; do not ask for confirmation to proceed with normal coding actions inside workspace.",
    "- Do not end with 'Proceed?' or similar approval prompts.",
    "- Do not report repo cleanliness/status unless user explicitly asked for git status.",
    "- Do not append unsolicited 'Next action' suggestions unless the user asked for options or next steps.",
    "- Respect response-shape constraints exactly (for example: 'summary only' means summary only).",
    "- Never mention verification commands/results unless verification was explicitly requested in the prompt.",
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
    writeFile: "edit-file",
    write_file: "edit-file",
    deleteFile: "delete-file",
    delete_file: "delete-file",
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
  const label = (() => {
    switch (toolName) {
      case "write-file":
      case "edit-file":
        return "Edited";
      case "delete-file":
        return "Deleted";
      case "read-file":
        return "Read";
      default:
        return formatToolLabel(toolName);
    }
  })();
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
      return command ? `Ran ${command}` : "Ran";
    }
    case "read-file":
    case "edit-file":
    case "write-file":
    case "delete-file":
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
  const seen = new Set<unknown>();
  const ignoredKeys = new Set(["type", "id", "name", "toolname", "tool_name", "args", "input", "parameters"]);
  const collect = (value: unknown, depth = 0): string[] => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    }
    if (!value || depth > 8) {
      return [];
    }
    if (Array.isArray(value)) {
      const chunks: string[] = [];
      for (const item of value) {
        chunks.push(...collect(item, depth + 1));
      }
      return chunks;
    }
    if (typeof value !== "object" || seen.has(value)) {
      return [];
    }
    seen.add(value);
    const objectValue = value as Record<string, unknown>;
    const preferredFields = [
      objectValue.output,
      objectValue.result,
      objectValue.text,
      objectValue.stdout,
      objectValue.stderr,
      objectValue.message,
      objectValue.error,
      objectValue.content,
      objectValue.response,
    ];
    const chunks: string[] = [];
    for (const field of preferredFields) {
      chunks.push(...collect(field, depth + 1));
    }
    if (chunks.length > 0) {
      return chunks;
    }
    for (const [key, field] of Object.entries(objectValue)) {
      if (ignoredKeys.has(key.toLowerCase())) {
        continue;
      }
      chunks.push(...collect(field, depth + 1));
    }
    return chunks;
  };
  return collect(raw).join("\n");
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

function formatToolResultProgressMessages(
  toolName: string,
  resultText: string,
  args?: Record<string, unknown>,
): string[] {
  if (!resultText.trim()) {
    return [];
  }
  switch (toolName) {
    case "run-command": {
      const lines: string[] = [];
      const emit = (label: string, text: string): void => {
        lines.push(`${label.padEnd(4, " ")}| ${compactProgressDetail(text, 96)}`);
      };
      const command = typeof args?.command === "string" ? args.command.trim() : "";
      if (command.length > 0) {
        lines.push(`Ran ${command}`);
      }
      const codeMatch = resultText.match(/(?:^|\n)exit_code=(\d+)/);
      if (codeMatch?.[1]) {
        emit("code", codeMatch[1]);
      }
      const outMatch = resultText.match(/(?:^|\n)stdout:\n([\s\S]*?)(?:\n\nstderr:\n|$)/);
      const errMatch = resultText.match(/(?:^|\n)stderr:\n([\s\S]*?)$/);
      const previewLimit = 8;
      const pushBlock = (label: string, block: string | undefined): void => {
        const content = block?.trim();
        if (!content) {
          return;
        }
        const blockLines = content
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0);
        const shown = blockLines.slice(0, previewLimit);
        for (const line of shown) {
          emit(label, line);
        }
        if (blockLines.length > shown.length) {
          emit(label, `… +${blockLines.length - shown.length} more lines`);
        }
      };
      pushBlock("out", outMatch?.[1]);
      pushBlock("err", errMatch?.[1]);
      return lines;
    }
    case "edit-file":
    case "write-file":
    case "delete-file":
      break;
    default:
      return [];
  }
  const files = parseUnifiedDiffFiles(resultText, toolName === "write-file" ? 80 : 4);
  if (files.length === 0) {
    return [];
  }
  const lines: string[] = [];
  let verb = formatToolLabel(toolName);
  switch (toolName) {
    case "write-file":
      verb = "Edited";
      break;
    case "edit-file":
      verb = "Edited";
      break;
    case "delete-file":
      verb = "Deleted";
      break;
    default:
      break;
  }
  for (const file of files) {
    const diffBlock: string[] = [];
    if (toolName === "write-file" || toolName === "edit-file" || toolName === "delete-file") {
      diffBlock.push(`${verb} ${compactProgressDetail(file.path, 64)}`);
      diffBlock.push("");
    } else {
      lines.push(`${verb} ${compactProgressDetail(file.path, 48)} (+${file.added} -${file.removed})`);
    }
    for (const preview of file.preview) {
      if (preview.kind === "del") {
        if (toolName === "write-file" || toolName === "edit-file" || toolName === "delete-file") {
          diffBlock.push(`${preview.oldLine ?? "?"} - ${preview.text}`);
        } else {
          lines.push(`${preview.oldLine ?? "?"} - ${compactProgressDetail(preview.text, 96)}`);
        }
      } else if (preview.kind === "add") {
        if (toolName === "write-file" || toolName === "edit-file" || toolName === "delete-file") {
          diffBlock.push(`${preview.newLine ?? "?"} + ${preview.text}`);
        } else {
          lines.push(`${preview.newLine ?? "?"} + ${compactProgressDetail(preview.text, 96)}`);
        }
      } else {
        if (toolName === "write-file" || toolName === "edit-file" || toolName === "delete-file") {
          diffBlock.push(`${preview.newLine ?? preview.oldLine ?? "?"}   ${preview.text}`);
        } else {
          lines.push(`${preview.newLine ?? preview.oldLine ?? "?"}   ${compactProgressDetail(preview.text, 96)}`);
        }
      }
    }
    if (file.previewOverflow > 0) {
      if (toolName === "write-file" || toolName === "edit-file" || toolName === "delete-file") {
        diffBlock.push(`… +${file.previewOverflow} more changed lines`);
      } else {
        lines.push(`… +${file.previewOverflow} more changed lines`);
      }
    }
    if ((toolName === "write-file" || toolName === "edit-file" || toolName === "delete-file") && diffBlock.length > 0) {
      lines.push(diffBlock.join("\n"));
    }
  }
  return lines;
}

export function collectToolProgressFromStep(
  step: unknown,
): Array<{ callId?: string; name: string; args: Record<string, unknown>; result: string }> {
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

  const progress: Array<{ callId?: string; name: string; args: Record<string, unknown>; result: string }> = [];
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
      const name = [entry.toolName, entry.name].find((value) => typeof value === "string") as string | undefined;
      if (!name) {
        continue;
      }
      const callId = typeof entry.id === "string" ? entry.id : undefined;
      const args = parseToolArgs(entry.args ?? entry.input ?? entry.parameters);
      progress.push(callId ? { callId, name, args, result: "" } : { name, args, result: "" });
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
        stderr?: unknown;
        message?: unknown;
        error?: unknown;
      };
      const name = [entry.toolName, entry.name].find((value) => typeof value === "string") as string | undefined;
      if (!name) {
        continue;
      }
      const callId = typeof entry.id === "string" ? entry.id : undefined;
      const args = parseToolArgs(entry.args ?? entry.input ?? entry.parameters);
      const resultSource =
        entry.output ?? entry.result ?? entry.text ?? entry.stdout ?? entry.stderr ?? entry.message ?? entry.error;
      progress.push(
        callId
          ? { callId, name, args, result: parseToolResultText(resultSource) }
          : { name, args, result: parseToolResultText(resultSource) },
      );
    }
  }
  return progress;
}

function collectToolProgressFromToolCalls(
  toolCalls: unknown[],
): Array<{ callId?: string; name: string; args: Record<string, unknown>; result: string }> {
  const progress: Array<{ callId?: string; name: string; args: Record<string, unknown>; result: string }> = [];
  for (const call of toolCalls) {
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
      payload?: unknown;
      output?: unknown;
      result?: unknown;
      text?: unknown;
      stdout?: unknown;
      stderr?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const payload =
      entry.payload && typeof entry.payload === "object" ? (entry.payload as Record<string, unknown>) : undefined;
    const name = [entry.toolName, entry.name, payload?.toolName, payload?.name].find(
      (value) => typeof value === "string",
    ) as string | undefined;
    if (!name) {
      continue;
    }
    const callId = typeof entry.id === "string" ? entry.id : typeof payload?.id === "string" ? payload.id : undefined;
    const args = parseToolArgs(entry.args ?? entry.input ?? entry.parameters ?? payload?.args ?? payload?.input);
    const resultSource =
      entry.output ??
      entry.result ??
      entry.text ??
      entry.stdout ??
      entry.stderr ??
      entry.message ??
      entry.error ??
      payload?.output ??
      payload?.result ??
      payload?.text ??
      payload?.response;
    const result = parseToolResultText(resultSource);
    progress.push(callId ? { callId, name, args, result } : { name, args, result });
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
  onProgress?: (event: {
    message: string;
    kind?: "status" | "tool" | "error";
    toolCallId?: string;
    toolName?: string;
    phase?: "start" | "result" | "error";
  }) => void;
  onDebug?: (event: string, fields?: Record<string, unknown>) => void;
}): Promise<ChatResponse> {
  type ProgressEventPayload = NonNullable<ChatResponse["progressEvents"]>[number];
  const INITIAL_MAX_STEPS = 50;
  const REQUIRED_TOOLS_RETRY_MAX_STEPS = 10;
  const TIMEOUT_RECOVERY_MAX_STEPS = 8;
  const TIMEOUT_RECOVERY_TIMEOUT_MS = 45_000;
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
      instructions: createInstructions(input.soulPrompt),
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
  const resourceId = input.request.resourceId?.trim() || appConfig.memory.resourceId;
  const memoryOptions = input.request.sessionId ? { thread: input.request.sessionId, resource: resourceId } : undefined;
  emitDebug("agent.context.built", {
    model_selected: model,
    history_messages: input.request.history.length,
    has_memory: Boolean(memoryOptions),
  });
  const seenToolNames = new Set<string>();
  const emittedProgressMessages: string[] = [];
  const emittedProgressEvents: ProgressEventPayload[] = [];
  const seenProgressEvents = new Set<string>();
  const observedToolCallIds = new Set<string>();
  let lastToolFailureReason: string | undefined;
  const emitProgress = (event: {
    message: string;
    kind?: "status" | "tool" | "error";
    toolCallId?: string;
    toolName?: string;
    phase?: "start" | "result" | "error";
  }): void => {
    const trimmed = event.message.trim();
    if (trimmed.length === 0) {
      return;
    }
    const dedupeKey = [
      event.kind ?? "tool",
      event.toolCallId ?? "",
      event.toolName ?? "",
      event.phase ?? "",
      trimmed.toLowerCase(),
    ].join("|");
    if (!seenProgressEvents.has(dedupeKey)) {
      seenProgressEvents.add(dedupeKey);
      emittedProgressMessages.push(trimmed);
      emittedProgressEvents.push({
        message: trimmed,
        kind: event.kind,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: event.phase,
      });
    }
    input.onProgress?.({
      ...event,
      message: trimmed,
    });
  };
  const emitToolProgressEntries = (
    tools: Array<{ callId?: string; name: string; args: Record<string, unknown>; result: string }>,
  ): void => {
    for (const tool of tools) {
      const canonicalToolName = canonicalToolId(tool.name);
      observedToolCallIds.add(canonicalToolName);
      const startMessage = formatToolProgressMessage(canonicalToolName, tool.args);
      const startDedupeKey = JSON.stringify({
        kind: "call",
        callId: tool.callId ?? "",
        name: tool.name,
        message: startMessage,
      });
      if (!seenToolNames.has(startDedupeKey)) {
        seenToolNames.add(startDedupeKey);
        emitProgress({
          message: startMessage,
          kind: "tool",
          toolCallId: tool.callId,
          toolName: canonicalToolName,
          phase: "start",
        });
      }
      const resultMessages = formatToolResultProgressMessages(canonicalToolName, tool.result, tool.args);
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
          emitProgress({
            message: failureMessage,
            kind: "error",
            toolCallId: tool.callId,
            toolName: canonicalToolName,
            phase: "error",
          });
        }
      }
      for (const resultMessage of resultMessages) {
        const resultDedupeKey = JSON.stringify({
          kind: "result",
          callId: tool.callId ?? "",
          name: tool.name,
          message: resultMessage,
        });
        if (seenToolNames.has(resultDedupeKey)) {
          continue;
        }
        seenToolNames.add(resultDedupeKey);
        emitProgress({
          message: resultMessage,
          kind: "tool",
          toolCallId: tool.callId,
          toolName: canonicalToolName,
          phase: "result",
        });
      }
    }
  };
  const emitToolProgress = (step: unknown): void => {
    emitToolProgressEntries(collectToolProgressFromStep(step));
  };

  const agentPrompt = agentInput;
  const initialMaxSteps = INITIAL_MAX_STEPS;
  const callTimeoutMs = CODER_TIMEOUT_MS;
  emitProgress({ message: "Working…", kind: "status" });
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
    emitProgress({ message: `Tool failed: ${lastToolFailureReason}`, kind: "error" });
    emitDebug("agent.generate.retry_failed", {
      model,
      reason: "initial",
      error: lastToolFailureReason,
    });
    if (/timed out/i.test(lastToolFailureReason)) {
      emitDebug("agent.generate.retry", {
        model,
        reason: "initial_timeout_recovery",
        tool_choice: "required",
        max_steps: TIMEOUT_RECOVERY_MAX_STEPS,
      });
      try {
        modelCallCount += 1;
        result = await generateWithTimeout(
          agentPrompt,
          {
            maxSteps: TIMEOUT_RECOVERY_MAX_STEPS,
            toolChoice: "required",
            memory: memoryOptions,
            onStepFinish: emitToolProgress,
          },
          TIMEOUT_RECOVERY_TIMEOUT_MS,
        );
        emitDebug("agent.generate.done", {
          model,
          reason: "initial_timeout_recovery",
          tool_calls: result.toolCalls.length,
          text_chars: result.text.trim().length,
        });
      } catch (retryError) {
        lastToolFailureReason = retryError instanceof Error ? retryError.message : String(retryError);
        emitProgress({ message: `Tool failed: ${lastToolFailureReason}`, kind: "error" });
        emitDebug("agent.generate.retry_failed", {
          model,
          reason: "initial_timeout_recovery",
          error: lastToolFailureReason,
        });
      }
    }
    if (!result) {
      const output = finalizeAssistantOutput(
        "",
        input.request.message,
        observedToolCallIds.size,
        lastToolFailureReason,
      );
      const completionTokens = estimateTokens(output);
      return {
        model,
        output,
        toolCalls: Array.from(observedToolCallIds),
        progressMessages: emittedProgressMessages,
        progressEvents: emittedProgressEvents,
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
  }
  if (!result) {
    const output = finalizeAssistantOutput("", input.request.message, observedToolCallIds.size, lastToolFailureReason);
    const completionTokens = estimateTokens(output);
    return {
      model,
      output,
      toolCalls: Array.from(observedToolCallIds),
      progressMessages: emittedProgressMessages,
      progressEvents: emittedProgressEvents,
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

  if (result.toolCalls.length === 0) {
    emitDebug("agent.generate.retry", {
      model,
      reason: "required_tools_no_calls",
      tool_choice: "required",
      max_steps: REQUIRED_TOOLS_RETRY_MAX_STEPS,
    });
    try {
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
    } catch (error) {
      const retryError = error instanceof Error ? error.message : String(error);
      lastToolFailureReason = retryError;
      emitProgress({ message: `Tool failed: ${retryError}`, kind: "error" });
      emitDebug("agent.generate.retry_failed", {
        model,
        reason: "required_tools_no_calls",
        error: retryError,
      });
    }
  }

  const canRetryOnBaseModel = input.request.model !== model;
  if (result.toolCalls.length === 0 && canRetryOnBaseModel) {
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

  const normalizedToolCalls = normalizeToolCalls(result.toolCalls);
  if (normalizedToolCalls.length > 0) {
    const lateToolProgress = collectToolProgressFromToolCalls(normalizedToolCalls);
    emitDebug("agent.tool_progress.late", {
      model,
      tool_calls: normalizedToolCalls.length,
      late_entries: lateToolProgress.length,
    });
    emitToolProgressEntries(lateToolProgress);
  }
  const toolCallIds = collectToolCallIds(normalizedToolCalls);
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
      emitProgress({ message: `Tool failed: ${lastToolFailureReason}`, kind: "error" });
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
    progressMessages: emittedProgressMessages,
    progressEvents: emittedProgressEvents,
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
