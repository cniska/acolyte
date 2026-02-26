import { createAgent } from "./agent-factory";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import type { StreamEvent } from "./backend";
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
    "",
    "Tool Selection:",
    "- Prefer dedicated tools over shell equivalents: `find-files` not `ls`/`find`, `search-files` not `grep`, `read-file` not `cat`, `edit-file`/`edit-code` not `sed`/`awk`.",
    "- Use `find-files` to locate files by name; use `search-files` to search file contents.",
    "- Use `edit-file` for targeted single-site text edits; use `edit-code` for multi-site structural changes, renames across call sites, or signature rewrites in code files (TS/TSX/JS/JSX/HTML/CSS).",
    "- Use `git-status`/`git-diff` for change inspection; use `web-search`/`web-fetch` only when external lookup is needed.",
    "- Default to tool execution. If a task can be completed with available tools, do it with tools instead of providing instructions/code-only replies.",
    "",
    "Workflow:",
    "- Read relevant files before editing; avoid speculative code changes.",
    "- Minimize tool round trips: for focused file edits, one targeted read then one edit is preferred.",
    "- For edit/update requests, check the target file with `read-file` first, then apply `edit-file` with a short unique `find` snippet (a few surrounding lines, never the whole file) and `replace` with the updated snippet.",
    "- For requests that create a new file, call `create-file` with full file content directly (do not answer with file contents in chat).",
    "- If filename/path is not specified, choose a sensible default filename and create it (for example `sum.rs`) using `create-file`.",
    "- After a successful `edit-file` for a straightforward request, do not re-read or re-edit the same file in the same turn unless the user explicitly asked for verification or additional changes.",
    "- Never claim a file was created/edited/found unless that is confirmed by tool results in the current turn.",
    "- When asked to edit a specific file and it does not exist, state that the file is missing instead of silently creating a replacement file.",
    "",
    "Execution Loop:",
    "- Understand request and identify concrete target files/commands.",
    "- Before the first tool call, briefly explain what you're about to do in natural language (no labels or prefixes).",
    "- Implement changes directly with tools.",
    "- Verify when explicitly requested, when repo policy requires it, or when risk is high.",
    "- Keep working until requested changes are complete or a real blocker is hit.",
    "",
    "Completion:",
    "- For multi-step work, keep an internal checklist and do not finish until all requested items are addressed.",
    "- Execute directly for actionable requests; do not ask for confirmation for normal workspace actions.",
    "- If blocked by missing or ambiguous requirements, ask one short clarification question, then continue.",
    "- If a sensible default exists (for example filename), choose it and continue.",
    "- Avoid option menus for straightforward tasks.",
    "- Do not offer variants/options before performing a straightforward artifact request; create/edit the file first, then report outcome.",
    "- If the requested change is already satisfied, reply with one short line stating no changes were needed, then stop.",
    "- In final summaries, lead with outcomes, not action preambles.",
    "- Do not report repo cleanliness/status unless user explicitly asked for git status.",
    "- Do not append unsolicited 'Next action' suggestions unless the user asked for options or next steps.",
    "- Respect response-shape constraints exactly (for example: 'summary only' means summary only).",
    "- Never reply with 'save this as ...' or ask the user to copy/paste file contents.",
    "- Never mention verification commands/results unless verification was explicitly requested in the prompt.",
    "- Keep final output concise and outcome-focused; summarize what changed instead of narrating each step.",
    "- End with a brief natural summary of what changed and any relevant notes.",
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
    findFiles: "find-files",
    find_files: "find-files",
    searchFiles: "search-files",
    search_files: "search-files",
    searchRepo: "search-files",
    search_repo: "search-files",
    editFile: "edit-file",
    edit_file: "edit-file",
    createFile: "create-file",
    create_file: "create-file",
    writeFile: "create-file",
    write_file: "create-file",
    editCode: "edit-code",
    edit_code: "edit-code",
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

function formatToolArgs(args: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      out[key] = value.length > 80 ? `${value.slice(0, 79)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
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

export function formatToolHeader(toolName: string, args: Record<string, unknown>): string {
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
  onEvent?: (event: StreamEvent) => void;
  onDebug?: (event: string, fields?: Record<string, unknown>) => void;
}): Promise<ChatResponse> {
  const INITIAL_MAX_STEPS = 50;
  const TIMEOUT_RECOVERY_MAX_STEPS = 8;
  const TIMEOUT_RECOVERY_TIMEOUT_MS = 45_000;
  const CODER_TIMEOUT_MS = 90_000;

  const role = selectAgentRole(input.request.message);
  const emitDebug = (event: string, fields: Record<string, unknown> = {}): void => {
    input.onDebug?.(event, { role, ...fields });
  };

  emitDebug("agent.role.selected", { model_requested: input.request.model });
  const resolved = resolveRunnableModel(role, input.request.model);
  if (!resolved.available) {
    return buildMockReply(input.request, `Provider '${resolved.provider}' is not configured.`);
  }

  const model = resolved.model;
  let modelCallCount = 0;
  const observedToolNames = new Set<string>();
  let lastToolFailureReason: string | undefined;

  // Map Mastra native toolCallIds to correlate with onToolOutput from mastra-tools.
  // fullStream emits tool-call with native IDs; onToolOutput uses synthetic IDs.
  // Queue native IDs per tool name and peek during onToolOutput to correlate.
  const nativeIdQueue = new Map<string, string[]>();

  const emitEvent = (event: StreamEvent): void => {
    input.onEvent?.(event);
  };

  // Callback wired to mastra-tools for real-time tool execution output.
  let toolOutputHandler: ((event: { toolName: string; message: string; toolCallId?: string }) => void) | null = null;

  const agent = createAgent({
    id: `acolyte-${role}`,
    name: `Acolyte ${role[0].toUpperCase()}${role.slice(1)}`,
    model,
    instructions: createInstructions(input.soulPrompt),
    tools: toolsForAgent({
      onToolOutput: (event) => {
        toolOutputHandler?.(event);
      },
    }),
  });

  toolOutputHandler = (event) => {
    const content = event.message.trim();
    if (!content) {
      return;
    }
    // Map synthetic toolCallId to native one.
    const queue = nativeIdQueue.get(event.toolName);
    const nativeId = queue?.[queue.length - 1] ?? event.toolCallId ?? event.toolName;
    emitEvent({
      type: "tool-output",
      toolCallId: nativeId,
      toolName: event.toolName,
      content,
    });
  };

  const streamWithTimeout = async (
    prompt: string,
    options: {
      maxSteps: number;
      toolChoice: "auto" | "required";
      memory: { thread: string; resource: string } | undefined;
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
        .stream(prompt, options)
        .then(async (streamOutput) => {
          const reader = streamOutput.fullStream.getReader();
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) {
              break;
            }
            if (!chunk || typeof chunk !== "object") {
              continue;
            }
            const typed = chunk as { type?: string; payload?: unknown };
            switch (typed.type) {
              case "text-delta": {
                const p = typed.payload as { text?: string } | undefined;
                if (typeof p?.text === "string" && p.text.length > 0) {
                  emitEvent({ type: "text-delta", text: p.text });
                }
                break;
              }
              case "reasoning-delta": {
                const p = typed.payload as { text?: string } | undefined;
                if (typeof p?.text === "string" && p.text.length > 0) {
                  emitEvent({ type: "reasoning", text: p.text });
                }
                break;
              }
              case "tool-call": {
                const p = typed.payload as
                  | {
                      toolCallId?: string;
                      toolName?: string;
                      args?: Record<string, unknown>;
                    }
                  | undefined;
                if (p?.toolCallId && p?.toolName) {
                  const toolName = canonicalToolId(p.toolName);
                  observedToolNames.add(toolName);
                  const args = (p.args ?? {}) as Record<string, unknown>;
                  emitDebug("agent.tool.call", {
                    tool: toolName,
                    ...formatToolArgs(args),
                  });
                  // Queue native ID for onToolOutput correlation.
                  let queue = nativeIdQueue.get(toolName);
                  if (!queue) {
                    queue = [];
                    nativeIdQueue.set(toolName, queue);
                  }
                  queue.push(p.toolCallId);
                  emitEvent({
                    type: "tool-call",
                    toolCallId: p.toolCallId,
                    toolName,
                    args,
                  });
                }
                break;
              }
              case "tool-result": {
                const p = typed.payload as
                  | {
                      toolCallId?: string;
                      toolName?: string;
                      result?: unknown;
                    }
                  | undefined;
                if (p?.toolCallId && p?.toolName) {
                  const toolName = canonicalToolId(p.toolName);
                  // Dequeue native ID.
                  const queue = nativeIdQueue.get(toolName);
                  if (queue?.[queue.length - 1] === p.toolCallId) {
                    queue.pop();
                  }
                  const isError =
                    typeof p.result === "object" &&
                    p.result !== null &&
                    "error" in (p.result as Record<string, unknown>);
                  if (isError) {
                    lastToolFailureReason = String((p.result as { error?: unknown }).error ?? "Tool error");
                    emitDebug("agent.tool.error", {
                      tool: toolName,
                      error: lastToolFailureReason,
                    });
                  }
                  emitEvent({
                    type: "tool-result",
                    toolCallId: p.toolCallId,
                    toolName,
                    ...(isError ? { isError: true } : {}),
                  });
                }
                break;
              }
              case "tool-error": {
                const p = typed.payload as { error?: string } | undefined;
                const errorMsg = typeof p?.error === "string" ? p.error : "Unknown tool error";
                lastToolFailureReason = errorMsg;
                emitEvent({ type: "error", error: errorMsg });
                break;
              }
              // step-finish, step-start, etc.: internal only, not forwarded.
            }
          }
          return await streamOutput.getFullOutput();
        })
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

  emitEvent({ type: "status", message: "Working…" });
  emitDebug("agent.generate.start", {
    model,
    tool_choice: "auto",
    max_steps: INITIAL_MAX_STEPS,
    reason: "initial",
  });

  let result: Awaited<ReturnType<typeof agent.generate>> | undefined;
  try {
    modelCallCount += 1;
    result = await streamWithTimeout(
      agentInput,
      {
        maxSteps: INITIAL_MAX_STEPS,
        toolChoice: "auto",
        memory: memoryOptions,
      },
      CODER_TIMEOUT_MS,
    );
  } catch (error) {
    lastToolFailureReason = error instanceof Error ? error.message : String(error);
    emitEvent({ type: "error", error: `Tool failed: ${lastToolFailureReason}` });
    emitDebug("agent.generate.error", {
      model,
      reason: "initial",
      error: lastToolFailureReason,
    });
    // Timeout recovery: retry with reduced scope.
    if (/timed out/i.test(lastToolFailureReason)) {
      emitEvent({ type: "status", message: "Retrying after timeout…" });
      emitDebug("agent.generate.retry", {
        model,
        reason: "timeout_recovery",
        max_steps: TIMEOUT_RECOVERY_MAX_STEPS,
      });
      try {
        modelCallCount += 1;
        result = await streamWithTimeout(
          agentInput,
          {
            maxSteps: TIMEOUT_RECOVERY_MAX_STEPS,
            toolChoice: "auto",
            memory: memoryOptions,
          },
          TIMEOUT_RECOVERY_TIMEOUT_MS,
        );
        emitDebug("agent.generate.done", {
          model,
          reason: "timeout_recovery",
          tool_calls: result.toolCalls.length,
          text_chars: result.text.trim().length,
        });
      } catch (retryError) {
        lastToolFailureReason = retryError instanceof Error ? retryError.message : String(retryError);
        emitEvent({ type: "error", error: `Retry failed: ${lastToolFailureReason}` });
        emitDebug("agent.generate.retry_failed", {
          model,
          reason: "timeout_recovery",
          error: lastToolFailureReason,
        });
      }
    }
    if (!result) {
      const output = finalizeAssistantOutput("", input.request.message, observedToolNames.size, lastToolFailureReason);
      const completionTokens = estimateTokens(output);
      return {
        model,
        output,
        toolCalls: Array.from(observedToolNames),
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
    const output = finalizeAssistantOutput("", input.request.message, observedToolNames.size, lastToolFailureReason);
    const completionTokens = estimateTokens(output);
    return {
      model,
      output,
      toolCalls: Array.from(observedToolNames),
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

  const rawOutput = result.text.trim();
  const output = isReviewRequest(input.request.message)
    ? finalizeReviewOutput(rawOutput, input.request.message)
    : finalizeAssistantOutput(rawOutput, input.request.message, observedToolNames.size, lastToolFailureReason);
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
    toolCalls: Array.from(observedToolNames),
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
