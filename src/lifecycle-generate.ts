import type { Agent } from "./agent-contract";
import { estimateTokens } from "./agent-input";
import { createInstructions } from "./agent-instructions";
import { collectReminders, reminderTag } from "./agent-reminders";
import { renderReminder } from "./agent-reminders-render";
import { createAgent } from "./agent-stream";
import { appConfig } from "./app-config";
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
import {
  type GenerateOptions,
  type GenerateResult,
  promptUsageTotalTokens,
  type RunContext,
  type StreamChunk,
} from "./lifecycle-contract";
import { providerFromModel, reasoningProviderOptions } from "./provider-config";
import type { StreamError } from "./stream-error";
import type { ToolDefinition } from "./tool-contract";
import { extractToolErrorCode } from "./tool-error";
import { RUNNER_TOOL_SET, type Toolset } from "./tool-registry";
import { resetTurnStepCount } from "./tool-session";

function budgetState(ctx: RunContext): { used: number; limit: number } | undefined {
  const used = ctx.session.flags.turnStepCount;
  const limit = ctx.session.flags.turnStepLimit;
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) return undefined;
  return { used, limit };
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

function captureError(ctx: RunContext, message: string, meta?: CaptureErrorMeta): void {
  const kindCategory = categoryFromErrorKind(meta?.kind);
  const code =
    meta?.code ??
    extractToolErrorCode(message) ??
    (kindCategory ? errorCodeFromCategory(kindCategory) : undefined) ??
    LIFECYCLE_ERROR_CODES.unknown;
  const category = categoryFromErrorCode(code) ?? kindCategory ?? "other";
  const kind = meta?.kind ?? errorKindFromCategory(category);
  ctx.currentError = { message, code, category, source: meta?.source, tool: meta?.tool };
  ctx.errorStats[category] += 1;
  ctx.debug("lifecycle.error", {
    source: meta?.source ?? "generate",
    tool: meta?.tool ?? null,
    code: code ?? null,
    kind,
    category,
    message: message.length > 240 ? `${message.slice(0, 239)}…` : message,
  });
}

function currentStreamError(ctx: RunContext): StreamError | undefined {
  if (!ctx.currentError) return undefined;
  const err = ctx.currentError;
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
  workspace: string | undefined;
  model: string;
  tools: Toolset;
}): Agent {
  return createAgent({
    model: input.model,
    instructions: createInstructions(input.soulPrompt, input.workspace),
    tools: input.tools as Record<string, ToolDefinition>,
  });
}

export async function phaseGenerate(ctx: RunContext, opts: GenerateOptions): Promise<void> {
  ctx.currentError = undefined;
  resetTurnStepCount(ctx.session, opts.turnLimit);
  const prompt = ctx.baseAgentInput;
  ctx.emit({ type: "status", state: { kind: "running" } });
  ctx.emit({
    type: "usage",
    inputTokens: emitInputTokens(ctx),
    outputTokens: ctx.outputTokensAccum,
  });
  ctx.debug("lifecycle.generate.start", {
    model: ctx.model,
    turn_limit: opts.turnLimit ?? null,
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
    });
  } catch (error) {
    const message = errorMessage(error);
    const code = errorCode(error);
    captureError(ctx, message, { source: "generate", code });
    ctx.debug("lifecycle.generate.error", { model: ctx.model, error: message });
  }
}

async function streamWithTimeout(ctx: RunContext, prompt: string, timeoutMs: number): Promise<GenerateResult> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();

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
    const provider = providerFromModel(appConfig.model);
    const providerOptions = reasoningProviderOptions(provider, appConfig.reasoning);
    const temperature = providerOptions ? undefined : (ctx.temperature ?? appConfig.temperature);
    const streamOutput = await ctx.agent.stream(prompt, {
      toolChoice: "auto",
      preCallInputTokenLimit: ctx.policy.contextMaxTokens,
      onBeforeNextCall: (messages) => {
        const reminders = collectReminders({
          messages,
          callLog: ctx.session.callLog,
          writeToolSet: ctx.session.writeTools,
          runnerToolSet: RUNNER_TOOL_SET,
          budget: budgetState(ctx),
        });
        if (reminders.length > 0) {
          ctx.debug("lifecycle.reminders.injected", {
            count: reminders.length,
            tags: reminders.map(reminderTag),
          });
        }
        return reminders.map(renderReminder);
      },
      ...(typeof temperature === "number" ? { temperature } : {}),
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

function completeToolCall(ctx: RunContext, toolCallId: string, toolName: string): void {
  const started = ctx.toolCallStartedAt.get(toolCallId);
  if (!started) return;
  const durationMs = Date.now() - started.startedAtMs;
  ctx.debug("lifecycle.tool.result", {
    tool: toolName,
    tool_call_id: toolCallId,
    duration_ms: durationMs,
    is_error: false,
  });
  ctx.toolCallStartedAt.delete(toolCallId);
}

function emitToolResult(ctx: RunContext, toolCallId: string, toolName: string, isError: boolean): void {
  ctx.emit({
    type: "tool-result",
    toolCallId,
    toolName,
    ...(isError
      ? {
          isError: true,
          ...(ctx.currentError?.code ? { errorCode: ctx.currentError.code } : {}),
          ...(currentStreamError(ctx) ? { error: currentStreamError(ctx) } : {}),
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

function clearResolvedToolError(ctx: RunContext, started: { toolName: string }): void {
  if (!ctx.currentError) return;
  if (ctx.currentError.source !== "tool-error" && ctx.currentError.source !== "tool-result") return;
  const failedTool = ctx.currentError.tool;
  if (!failedTool) return;
  if (failedTool === started.toolName) {
    ctx.currentError = undefined;
  }
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
    const started = ctx.toolCallStartedAt.get(p.toolCallId);
    const resultRecord =
      typeof p.result === "object" && p.result !== null ? (p.result as Record<string, unknown>) : null;
    const isError = Boolean(resultRecord && "error" in resultRecord);
    if (isError) {
      const parsed = parseError(resultRecord?.error);
      const errorInfo = parsed.ok ? parsed.value : { message: "Tool error" };
      const resultCode = typeof resultRecord?.code === "string" ? resultRecord.code : undefined;
      captureError(ctx, errorInfo.message, {
        source: "tool-result",
        tool: toolName,
        code: resultCode ?? errorInfo.code,
        kind: errorInfo.kind,
      });
      ctx.debug("lifecycle.tool.error", { tool: toolName, error: errorInfo.message });
    } else {
      clearResolvedToolError(ctx, started ?? { toolName });
    }
    if (!isError) accountMemoryRecallTokens(ctx, toolName, p.result);
    completeToolCall(ctx, p.toolCallId, toolName);
    emitToolResult(ctx, p.toolCallId, toolName, isError);
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
    captureError(ctx, errorInfo.message, {
      source: "tool-error",
      tool: toolName,
      code: payloadCode ?? errorInfo.code,
      kind: payloadKind ?? errorInfo.kind,
    });
    ctx.debug("lifecycle.tool.error", { tool: toolName, error: errorInfo.message });
    if (p?.toolCallId && p?.toolName) {
      completeToolCall(ctx, p.toolCallId, p.toolName);
      emitToolResult(ctx, p.toolCallId, p.toolName, true);
    }
  },

  "model-usage"(ctx, chunk) {
    if (chunk.type !== "model-usage") return;
    const p = chunk.payload;
    if (typeof p?.inputTokens === "number") ctx.inputTokensAccum += p.inputTokens;
    if (typeof p?.outputTokens === "number") ctx.outputTokensAccum += p.outputTokens;
    ctx.modelCallCount += 1;
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
