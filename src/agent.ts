import { createAgent } from "./agent-factory";
import { type AgentMode, agentModes, classifyMode, modeForTool } from "./agent-modes";
import { getProjectLineWidth } from "./agent-tools";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import type { StreamEvent } from "./client";
import { toolMeta, toolsForAgent } from "./mastra-tools";
import { isProviderAvailable, type ModelProviderName, providerFromModel } from "./provider-config";
import { formatToolLabel } from "./tool-labels";

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

export function createSubagentContext(req: ChatRequest): string {
  const scope = req.history.length > 0 ? `${req.history.length} history messages` : "no history";
  return ["Agent: Acolyte", `Goal: ${req.message.trim()}`, `Context: ${scope}; model=${req.model}`].join("\n");
}

const BASE_INSTRUCTIONS = [
  "- Prefer dedicated tools over shell equivalents.",
  "- Default to tool execution over chat-only replies.",
  "- Keep working until done or blocked. If blocked, ask one short question.",
].join("\n");

export function createModeInstructions(mode: AgentMode): string {
  const { tools, preamble } = agentModes[mode];
  const lines: string[] = preamble.map((p) => `- ${p}`);
  for (const toolId of tools) {
    const meta = toolMeta[toolId];
    if (meta?.instruction) {
      lines.push(`- ${meta.instruction}`);
    }
  }
  const lineWidth = getProjectLineWidth();
  if (lineWidth && mode === "work") {
    lines.push(`- Keep lines under ${lineWidth} characters.`);
  }
  return lines.join("\n");
}

export function createInstructions(baseInstructions: string, mode: AgentMode): string {
  const modeInstructions = createModeInstructions(mode);
  return `${baseInstructions}\n\n${BASE_INSTRUCTIONS}\n\n${modeInstructions}`;
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
    return "No final response after tool execution. Retry, or check server logs if this repeats.";
  }
  if (lastToolFailureReason) {
    return `No output from model. Last tool error: ${lastToolFailureReason}`;
  }
  return "No output from model. Check /status and server logs, then retry or switch model/provider.";
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
  const STEP_TIMEOUT_MS = 120_000;

  const emitDebug = (event: string, fields: Record<string, unknown> = {}): void => {
    input.onDebug?.(event, fields);
  };

  const classifiedMode = classifyMode(input.request.message);
  const requestedModel = appConfig.models[classifiedMode] ?? input.request.model;
  const resolved = resolveRunnableModel(requestedModel);
  if (!resolved.available) {
    throw new Error(
      `Provider '${resolved.provider}' is not configured for model '${resolved.model}'. ` +
        "Set the API key in your config or environment, or switch to another model.",
    );
  }

  const model = resolved.model;
  let modelCallCount = 0;
  const observedToolNames = new Set<string>();
  let lastToolFailureReason: string | undefined;
  let currentMode: AgentMode = "plan";

  // Map Mastra native toolCallIds to correlate with onToolOutput from mastra-tools.
  // fullStream emits tool-call with native IDs; onToolOutput uses synthetic IDs.
  // Queue native IDs per tool name and peek during onToolOutput to correlate.
  const nativeIdQueue = new Map<string, string[]>();

  const emitEvent = (event: StreamEvent): void => {
    input.onEvent?.(event);
  };
  const modeProgressText = (): string => agentModes[currentMode].progressText;
  const emitModeStatus = (): void => {
    emitEvent({ type: "status", message: `${modeProgressText()} (${model})` });
  };

  // Callback wired to mastra-tools for real-time tool execution output.
  let toolOutputHandler: ((event: { toolName: string; message: string; toolCallId?: string }) => void) | null = null;

  const agent = createAgent({
    id: "acolyte",
    name: "Acolyte",
    model,
    instructions: createInstructions(input.soulPrompt, classifiedMode),
    tools: toolsForAgent({
      onToolOutput: (event) => {
        toolOutputHandler?.(event);
      },
    }),
  });

  toolOutputHandler = (event) => {
    if (!event.message.trim()) {
      return;
    }
    const content = event.message;
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
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const resetTimeout = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          reject(new Error(`Step timed out after ${timeoutMs}ms of inactivity`));
        }, timeoutMs);
      };
      resetTimeout();

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
            resetTimeout();
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
                  if (currentMode !== "verify") {
                    const inferredMode = modeForTool(toolName);
                    if (inferredMode !== currentMode) {
                      const previousMode = currentMode;
                      currentMode = inferredMode;
                      emitDebug("agent.mode.changed", { from: previousMode, to: currentMode, trigger: toolName });
                      emitModeStatus();
                    }
                  }
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
                const p = typed.payload as
                  | {
                      error?: unknown;
                      message?: string;
                      toolName?: string;
                      toolCallId?: string;
                    }
                  | undefined;
                const raw = p?.error ?? p?.message;
                const errorMsg =
                  typeof raw === "string"
                    ? raw
                    : raw instanceof Error
                      ? raw.message
                      : typeof raw === "object" && raw !== null && "message" in raw
                        ? String((raw as { message: unknown }).message)
                        : "Tool error";
                lastToolFailureReason = errorMsg;
                emitDebug("agent.tool.error", { error: errorMsg });
                // Mark the tool progress row as failed so the marker turns red.
                if (p?.toolCallId && p?.toolName) {
                  emitEvent({
                    type: "tool-result",
                    toolCallId: p.toolCallId,
                    toolName: canonicalToolId(p.toolName),
                    isError: true,
                  });
                }
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
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          resolve(value);
        })
        .catch((error) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          reject(error);
        });
    });

  const requestInput = createAgentInput(input.request);
  const subagentContext = createSubagentContext(input.request);
  const agentInput = `${subagentContext}\n\n${requestInput.input}`;
  const resourceId = input.request.resourceId?.trim() || appConfig.memory.resourceId;
  const memoryOptions =
    input.request.useMemory && input.request.sessionId
      ? { thread: input.request.sessionId, resource: resourceId }
      : undefined;

  emitDebug("agent.mode.classified", { mode: classifiedMode });
  emitDebug("agent.context.built", {
    mode: classifiedMode,
    model_selected: model,
    history_messages: input.request.history.length,
    has_memory: Boolean(memoryOptions),
  });

  emitModeStatus();
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
      STEP_TIMEOUT_MS,
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
      emitModeStatus();
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

  // Plan detection: if model described a plan without using tools, re-invoke with execution nudge.
  if (isPlanLikeOutput(result.text.trim()) && observedToolNames.size === 0) {
    emitDebug("agent.plan.detected", { text_chars: result.text.trim().length });
    emitModeStatus();
    try {
      modelCallCount += 1;
      const executionNudge = `${agentInput}\n\nExecute the task directly using tools. Do not describe a plan or ask for confirmation.`;
      result = await streamWithTimeout(
        executionNudge,
        {
          maxSteps: INITIAL_MAX_STEPS,
          toolChoice: "auto",
          memory: memoryOptions,
        },
        STEP_TIMEOUT_MS,
      );
      emitDebug("agent.generate.done", {
        model,
        reason: "plan_execution",
        tool_calls: result.toolCalls.length,
        text_chars: result.text.trim().length,
      });
    } catch (error) {
      lastToolFailureReason = error instanceof Error ? error.message : String(error);
      emitEvent({ type: "error", error: `Execution retry failed: ${lastToolFailureReason}` });
      emitDebug("agent.plan.execution_failed", { error: lastToolFailureReason });
    }
  }

  // Verify step: after code mode, if write tools were used, auto-verify.
  const VERIFY_MAX_STEPS = 30;
  const WRITE_TOOLS = ["edit-code", "edit-file", "create-file"];
  const usedWriteTools = WRITE_TOOLS.some((t) => observedToolNames.has(t));
  if (classifiedMode === "work" && usedWriteTools) {
    currentMode = "verify";
    emitModeStatus();
    emitDebug("agent.generate.start", { model, reason: "verify" });
    try {
      modelCallCount += 1;
      const verifyPrompt = createModeInstructions("verify");
      const verifyResult = await streamWithTimeout(
        verifyPrompt,
        {
          maxSteps: VERIFY_MAX_STEPS,
          toolChoice: "auto",
          memory: memoryOptions,
        },
        STEP_TIMEOUT_MS,
      );
      emitDebug("agent.generate.done", {
        model,
        reason: "verify",
        tool_calls: verifyResult.toolCalls.length,
        text_chars: verifyResult.text.trim().length,
      });
      // Only use verify output if it has something to say (i.e. failures).
      // Otherwise keep the code mode summary.
      const verifyText = verifyResult.text.trim();
      if (verifyText.length > 0) {
        result = verifyResult;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      emitDebug("agent.verify.failed", { error: reason });
      // Non-fatal: verification failure doesn't kill the response.
    }
  }

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

  emitDebug("agent.run.summary", {
    mode: classifiedMode,
    model,
    model_calls: modelCallCount,
    tool_calls: observedToolNames.size,
    tools: Array.from(observedToolNames).join(","),
    has_error: Boolean(lastToolFailureReason),
    output_chars: output.length,
    budget_warning: budgetWarning ?? null,
  });

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
