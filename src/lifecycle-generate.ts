import type { LanguageModelV4Message } from "@ai-sdk/provider";
import type { Agent, GenerateResult, StreamChunk } from "./agent-contract";
import { estimateTokens } from "./agent-input";
import { createInstructions } from "./agent-instructions";
import { renderBudgetNotice } from "./agent-reminders";
import { createAgent } from "./agent-stream";
import { unreachable } from "./assert";
import { errorCode, errorMessage, LIFECYCLE_ERROR_CODES } from "./error-contract";
import {
  categoryFromErrorCode,
  categoryFromErrorKind,
  createStreamError,
  type ErrorSource,
  errorCodeFromCategory,
  errorKindFromCategory,
  parseError,
} from "./error-handling";
import { t } from "./i18n";
import {
  createFinishPolicyState,
  decideFinish,
  type FinishErrorReason,
  renderReopenMessages,
} from "./lifecycle-completion";
import { BUDGET_NOTICE_FRACTION, MAX_TOOL_CALLS_PER_REQUEST } from "./lifecycle-constants";
import {
  type GenerateOptions,
  type LifecycleError,
  promptUsageTotalTokens,
  type RunContext,
} from "./lifecycle-contract";
import { createPromptCacheKey, promptCacheProviderOptions } from "./prompt-cache";
import { providerFromModel } from "./provider-config";
import type { StreamError } from "./stream-error";
import type { ToolDefinition } from "./tool-contract";
import { extractToolErrorCode } from "./tool-error";
import type { Toolset } from "./tool-registry";

function budgetNotice(ctx: RunContext): LanguageModelV4Message | undefined {
  if (ctx.session.budgetNoticeAnnounced) return undefined;
  const limit = ctx.session.maxToolCallsPerRequest ?? MAX_TOOL_CALLS_PER_REQUEST;
  const count = ctx.session.callLog.length;
  if (count < Math.ceil(BUDGET_NOTICE_FRACTION * limit)) return undefined;
  ctx.session.budgetNoticeAnnounced = true;
  return renderBudgetNotice(count, limit);
}

type CaptureErrorMeta = {
  source?: ErrorSource;
  tool?: string;
  code?: string;
  kind?: string;
};

function formatToolArgs(args: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      out[key] = value.length > 80 ? `${value.slice(0, 79)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (Array.isArray(value)) {
      const summary = JSON.stringify(value);
      out[key] = summary.length > 120 ? `${summary.slice(0, 119)}…` : summary;
    }
  }
  return out;
}

function emitInputTokens(ctx: RunContext): number {
  return Math.max(ctx.inputTokensAccum, promptUsageTotalTokens(ctx.promptUsage));
}

// A tool returning a nonzero exit or an error result is a normal outcome the model
// acts on — not a broken run. Errors are recorded for stats/UI and returned to the
// caller; only run-level (generate/lifecycle) errors are written to `ctx.currentError`,
// which means "the run itself is broken" and gates completion.
function captureError(ctx: RunContext, message: string, meta?: CaptureErrorMeta): LifecycleError {
  const kindCategory = categoryFromErrorKind(meta?.kind);
  const code =
    meta?.code ??
    extractToolErrorCode(message) ??
    (kindCategory ? errorCodeFromCategory(kindCategory) : undefined) ??
    LIFECYCLE_ERROR_CODES.unknown;
  const category = categoryFromErrorCode(code) ?? kindCategory ?? "other";
  const kind = meta?.kind ?? errorKindFromCategory(category);
  const error: LifecycleError = { message, code, category, source: meta?.source, tool: meta?.tool };
  ctx.errorStats[category] += 1;
  ctx.debug("lifecycle.error", {
    source: meta?.source ?? "generate",
    tool: meta?.tool ?? null,
    code: code ?? null,
    kind,
    category,
    message: message.length > 240 ? `${message.slice(0, 239)}…` : message,
  });
  return error;
}

function streamErrorFrom(err: LifecycleError): StreamError | undefined {
  return createStreamError({
    message: err.message,
    code: err.code,
    kind: err.category ? errorKindFromCategory(err.category) : undefined,
    source: err.source,
    tool: err.tool,
  }).error;
}

export function createRunAgent(input: {
  soulPrompt: string;
  projectRulesPrompt?: string;
  workspace: string | undefined;
  model: string;
  tools: Toolset;
}): Agent {
  return createAgent({
    model: input.model,
    instructions: createInstructions(input.soulPrompt, input.workspace, input.projectRulesPrompt),
    tools: input.tools as Record<string, ToolDefinition>,
  });
}

// User-audience prose for an error verdict, where the model's last message cannot be the answer
// (blank, a fragment, or filter-mangled). Distinct sink from the model-facing reopen nudge.
function finishErrorMessage(reason: FinishErrorReason): string {
  switch (reason) {
    case "empty-answer":
      return t("lifecycle.finish.empty_answer");
    case "truncated":
      return t("lifecycle.finish.truncated");
    case "content-filter":
      return t("lifecycle.finish.content_filter");
    case "provider-error":
      return t("lifecycle.finish.provider_error");
    default:
      return unreachable(reason);
  }
}

export async function phaseGenerate(ctx: RunContext, opts: GenerateOptions): Promise<void> {
  ctx.currentError = undefined;
  const prompt = ctx.baseAgentInput;
  ctx.emit({ type: "status", state: { kind: "running" } });
  ctx.emit({
    type: "usage",
    inputTokens: emitInputTokens(ctx),
    outputTokens: ctx.outputTokensAccum,
  });
  ctx.debug("lifecycle.generate.start", {
    model: ctx.model,
    ...(ctx.authRoute ? { auth_route: ctx.authRoute } : {}),
  });

  try {
    const preCallCount = ctx.modelCallCount;
    ctx.result = await streamWithTimeout(ctx, prompt, opts.timeoutMs);
    if (ctx.modelCallCount === preCallCount) {
      ctx.modelCallCount += 1;
      ctx.outputTokensAccum += estimateTokens(ctx.result.text);
    }
    ctx.streamingChars = 0;
    ctx.lastUsageEmitChars = 0;
    ctx.emit({
      type: "usage",
      inputTokens: ctx.inputTokensAccum,
      outputTokens: ctx.outputTokensAccum,
    });
    ctx.debug("lifecycle.generate.done", {
      model: ctx.model,
      tool_calls: ctx.result.toolCalls.length,
      text_chars: ctx.result.text.trim().length,
      finish_reason: ctx.result.finishReason ?? "unknown",
    });
  } catch (error) {
    const message = errorMessage(error);
    const code = errorCode(error);
    ctx.currentError = captureError(ctx, message, { source: "generate", code });
    ctx.debug("lifecycle.generate.error", { model: ctx.model, error: message });
  }
}

async function streamWithTimeout(ctx: RunContext, prompt: string, timeoutMs: number): Promise<GenerateResult> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  const finishPolicyState = createFinishPolicyState();

  const resetTimeout = () => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      const err = new Error(`Step timed out after ${timeoutMs}ms of inactivity`);
      (err as Error & { code: string }).code = LIFECYCLE_ERROR_CODES.timeout;
      controller.abort(err);
    }, timeoutMs);
  };

  try {
    resetTimeout();
    const provider = providerFromModel(ctx.model);
    const cacheKey = createPromptCacheKey({
      model: ctx.model,
      sessionId: ctx.request.sessionId,
      workspace: ctx.workspace,
    });
    const providerOptions = promptCacheProviderOptions(provider, cacheKey);
    const reasoning = ctx.reasoning;
    const temperature = reasoning ? undefined : ctx.temperature;
    const streamOutput = await ctx.agent.stream(prompt, {
      preCallInputTokenLimit: ctx.policy.contextMaxTokens,
      onBeforeNextCall: () => {
        const notice = budgetNotice(ctx);
        if (!notice) return [];
        ctx.debug("lifecycle.budget_notice.injected", {
          count: ctx.session.callLog.length,
          limit: ctx.session.maxToolCallsPerRequest ?? MAX_TOOL_CALLS_PER_REQUEST,
        });
        return [notice];
      },
      onBeforeFinish: ({ answerText, finishReason }) => {
        const decision = decideFinish({ state: finishPolicyState, step: { finalText: answerText, finishReason } });
        switch (decision.kind) {
          case "reopen":
            ctx.debug("lifecycle.completion.rejected", { action: "reopen", reason: decision.reason });
            break;
          case "error":
            ctx.currentError = {
              message: finishErrorMessage(decision.reason),
              code: LIFECYCLE_ERROR_CODES.unknown,
              category: "other",
              blocksCompletion: true,
            };
            ctx.debug("lifecycle.completion.rejected", { action: "error", reason: decision.reason });
            break;
          case "finish":
            break;
          default:
            unreachable(decision);
        }
        return renderReopenMessages(decision);
      },
      ...(typeof temperature === "number" ? { temperature } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(providerOptions ? { providerOptions } : {}),
    });
    const fullOutput = streamOutput.getFullOutput();
    // If the AI SDK rejects an internal promise outside the reader chain, pipe it into the
    // abort controller so the reader loop exits immediately instead of waiting for the timeout.
    fullOutput.catch((err) => {
      controller.abort(err instanceof Error ? err : new Error(String(err)));
    });
    const reader = streamOutput.fullStream.getReader();
    while (true) {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
          if (controller.signal.aborted) reject(controller.signal.reason);
        }),
      ]);
      if (result.done) break;
      const chunk = result.value;
      resetTimeout();
      if (chunk.type === "tool-error") {
        const p = chunk.payload;
        if (!p?.toolName && !p?.toolCallId) {
          const parsed = parseError(p?.error ?? p?.message);
          throw new Error(parsed.ok ? parsed.value.message : "Model stream error");
        }
      }
      processStreamChunk(ctx, chunk);
    }
    return (await fullOutput) as GenerateResult;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

function completeToolCall(ctx: RunContext, toolCallId: string, toolName: string, isError = false): void {
  const started = ctx.toolCallStartedAt.get(toolCallId);
  if (!started) return;
  const durationMs = Date.now() - started.startedAtMs;
  ctx.debug("lifecycle.tool.result", {
    tool: toolName,
    tool_call_id: toolCallId,
    duration_ms: durationMs,
    is_error: isError,
  });
  ctx.toolCallStartedAt.delete(toolCallId);
}

function emitToolResult(ctx: RunContext, toolCallId: string, toolName: string, error?: LifecycleError): void {
  const streamError = error ? streamErrorFrom(error) : undefined;
  ctx.emit({
    type: "tool-result",
    toolCallId,
    toolName,
    ...(error
      ? {
          isError: true,
          ...(error.code ? { errorCode: error.code } : {}),
          ...(streamError ? { error: streamError } : {}),
        }
      : {}),
  });
  ctx.emit({
    type: "usage",
    inputTokens: emitInputTokens(ctx),
    outputTokens: ctx.outputTokensAccum,
  });
}

const USAGE_EMIT_CHAR_INTERVAL = 20;
const AVERAGE_CHARS_PER_TOKEN = 4;

function emitStreamingUsage(ctx: RunContext, chars: number): void {
  ctx.streamingChars += chars;
  if (ctx.streamingChars - ctx.lastUsageEmitChars >= USAGE_EMIT_CHAR_INTERVAL) {
    ctx.lastUsageEmitChars = ctx.streamingChars;
    const streamingTokens = Math.ceil(ctx.streamingChars / AVERAGE_CHARS_PER_TOKEN);
    ctx.emit({
      type: "usage",
      inputTokens: emitInputTokens(ctx),
      outputTokens: ctx.outputTokensAccum + streamingTokens,
    });
  }
}

function accountMemoryRecallTokens(ctx: RunContext, toolName: string, result: unknown): void {
  if (toolName !== "memory-search") return;
  if (result === undefined) return;
  const serialized = JSON.stringify(result);
  if (!serialized) return;
  const tokens = estimateTokens(serialized);
  ctx.promptUsage.memoryTokens += tokens;
}

function commandExitError(toolName: string, resultRecord: Record<string, unknown> | null): string | undefined {
  const exitCode = resultRecord?.exitCode;
  if (typeof exitCode !== "number" || !Number.isInteger(exitCode) || exitCode === 0) return undefined;
  const command = resultRecord?.command;
  return typeof command === "string" && command.length > 0
    ? `${toolName} exited with code ${exitCode}: ${command}`
    : `${toolName} exited with code ${exitCode}`;
}

type ChunkHandler = (ctx: RunContext, chunk: StreamChunk) => void;

const CHUNK_HANDLERS: Record<StreamChunk["type"], ChunkHandler> = {
  "step-start"(ctx) {
    ctx.emit({ type: "text-delta", text: "\n" });
  },

  "text-delta"(ctx, chunk) {
    if (chunk.type !== "text-delta") return;
    const text = chunk.payload?.text;
    if (typeof text === "string" && text.length > 0) {
      ctx.emit({ type: "text-delta", text });
      emitStreamingUsage(ctx, text.length);
    }
  },

  "reasoning-delta"(ctx, chunk) {
    if (chunk.type !== "reasoning-delta") return;
    const text = chunk.payload?.text;
    if (typeof text === "string" && text.length > 0) {
      ctx.emit({ type: "reasoning", text });
      emitStreamingUsage(ctx, text.length);
    }
  },

  "tool-call"(ctx, chunk) {
    if (chunk.type !== "tool-call") return;
    const p = chunk.payload;
    if (!p?.toolCallId || !p?.toolName) return;
    const toolName = p.toolName;
    ctx.observedTools.add(toolName);
    const args = (p.args ?? {}) as Record<string, unknown>;
    ctx.toolCallStartedAt.set(p.toolCallId, {
      toolName,
      startedAtMs: Date.now(),
      targetPaths:
        typeof args.path === "string"
          ? [args.path]
          : Array.isArray(args.paths)
            ? args.paths.filter((p): p is string => typeof p === "string")
            : [],
    });
    ctx.debug("lifecycle.tool.call", { tool: toolName, ...formatToolArgs(args) });
    ctx.emit({ type: "tool-call", toolCallId: p.toolCallId, toolName, args });
  },

  "tool-result"(ctx, chunk) {
    if (chunk.type !== "tool-result") return;
    const p = chunk.payload;
    if (!p?.toolCallId || !p?.toolName) return;
    const toolName = p.toolName;
    const resultRecord =
      typeof p.result === "object" && p.result !== null ? (p.result as Record<string, unknown>) : null;
    const exitError = commandExitError(toolName, resultRecord);
    const isError = Boolean((resultRecord && "error" in resultRecord) || exitError);
    let error: LifecycleError | undefined;
    if (isError) {
      const parsed = parseError(resultRecord && "error" in resultRecord ? resultRecord.error : exitError);
      const errorInfo = parsed.ok ? parsed.value : { message: "Tool error" };
      const resultCode = typeof resultRecord?.code === "string" ? resultRecord.code : undefined;
      error = captureError(ctx, errorInfo.message, {
        source: "tool-result",
        tool: toolName,
        code: resultCode ?? errorInfo.code,
        kind: errorInfo.kind,
      });
      ctx.debug("lifecycle.tool.error", { tool: toolName, error: errorInfo.message });
    } else {
      accountMemoryRecallTokens(ctx, toolName, p.result);
    }
    completeToolCall(ctx, p.toolCallId, toolName, isError);
    emitToolResult(ctx, p.toolCallId, toolName, error);
  },

  "tool-error"(ctx, chunk) {
    if (chunk.type !== "tool-error") return;
    const p = chunk.payload;
    const raw = p?.error ?? p?.message;
    const parsed = parseError(raw);
    const errorInfo = parsed.ok ? parsed.value : { message: "Tool error" };
    const payloadCode = typeof p?.code === "string" ? p.code : undefined;
    const payloadKind = typeof p?.kind === "string" ? p.kind : undefined;
    const toolName = p?.toolName ?? "unknown";
    const error = captureError(ctx, errorInfo.message, {
      source: "tool-error",
      tool: toolName,
      code: payloadCode ?? errorInfo.code,
      kind: payloadKind ?? errorInfo.kind,
    });
    ctx.debug("lifecycle.tool.error", { tool: toolName, error: errorInfo.message });
    if (p?.toolCallId && p?.toolName) {
      completeToolCall(ctx, p.toolCallId, p.toolName, true);
      emitToolResult(ctx, p.toolCallId, p.toolName, error);
    }
  },

  "model-usage"(ctx, chunk) {
    if (chunk.type !== "model-usage") return;
    const p = chunk.payload;
    if (typeof p?.inputTokens === "number") ctx.inputTokensAccum += p.inputTokens;
    if (typeof p?.outputTokens === "number") ctx.outputTokensAccum += p.outputTokens;
    ctx.modelCallCount += 1;
    ctx.debug("lifecycle.model_usage", {
      inputTokens: p?.inputTokens,
      outputTokens: p?.outputTokens,
      cacheReadTokens: p?.cacheReadTokens,
      cacheWriteTokens: p?.cacheWriteTokens,
      reasoningTokens: p?.reasoningTokens,
    });
    ctx.emit({
      type: "usage",
      inputTokens: ctx.inputTokensAccum,
      outputTokens: ctx.outputTokensAccum,
    });
  },
};

function processStreamChunk(ctx: RunContext, chunk: StreamChunk): void {
  CHUNK_HANDLERS[chunk.type](ctx, chunk);
}
