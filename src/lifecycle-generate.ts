import type { Agent } from "./agent-contract";
import { estimateTokens } from "./agent-input";
import { createInstructions } from "./agent-instructions";
import { agentModes } from "./agent-modes";
import { createAgent } from "./agent-stream";
import { appConfig } from "./app-config";
import {
  categoryFromErrorCode,
  categoryFromErrorKind,
  createStreamError,
  type ErrorSource,
  errorCodeFromCategory,
  errorKindFromCategory,
  isEditFileMultiMatchSignal,
  parseErrorInfo,
} from "./error-handling";
import type { GenerateOptions, GenerateResult, LifecycleFeedback, LifecycleState, RunContext, StreamChunk } from "./lifecycle-contract";
import { resolveModeModel } from "./lifecycle-resolve";
import type { StreamError } from "./stream-error";
import type { ToolDefinition } from "./tool-contract";
import { extractToolErrorCode, LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { resetCycleStepCount } from "./tool-guards";
import type { Toolset } from "./tool-registry";

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

function captureError(
  ctx: RunContext,
  message: string,
  meta?: { source?: ErrorSource; tool?: string; code?: string; kind?: string },
): void {
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
  if (isEditFileMultiMatchSignal({ code, message })) ctx.sawEditFileMultiMatchError = true;
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

export function shouldYieldNow(ctx: RunContext, shouldYield?: () => boolean): boolean {
  if (!shouldYield) return false;
  if (!shouldYield()) return false;
  ctx.debug("lifecycle.yield", {
    generation_attempt: ctx.generationAttempt,
    regeneration_count: ctx.regenerationCount,
  });
  if (!ctx.result?.text.trim()) {
    ctx.result = {
      text: "Yielding to a newer pending message.",
      toolCalls: ctx.result?.toolCalls ?? [],
    };
  }
  return true;
}

export function createModeAgent(input: {
  soulPrompt: string;
  mode: RunContext["mode"];
  workspace: string | undefined;
  model: string;
  tools: Toolset;
}): Agent {
  return createAgent({
    model: input.model,
    instructions: createInstructions(input.soulPrompt, input.mode, input.workspace),
    tools: input.tools as Record<string, ToolDefinition>,
  });
}

export function setMode(ctx: RunContext, mode: RunContext["mode"], trigger?: string): void {
  if (ctx.mode === mode) return;
  const from = ctx.mode;
  ctx.mode = mode;
  ctx.session.mode = mode;
  ctx.debug("lifecycle.mode.changed", { from, to: mode, trigger: trigger ?? null });
  ctx.emit({ type: "status", message: `${agentModes[mode].statusText} (${ctx.model})` });
}

function ensureAgentForMode(ctx: RunContext): void {
  const resolved = resolveModeModel(ctx.mode, ctx.request.model);
  const nextModel = resolved.model;
  if (ctx.agentForMode === ctx.mode && ctx.model === nextModel) return;

  const previousMode = ctx.agentForMode;
  const previousModel = ctx.model;
  ctx.model = nextModel;
  ctx.agentForMode = ctx.mode;
  ctx.agent = createModeAgent({
    soulPrompt: ctx.soulPrompt,
    mode: ctx.mode,
    workspace: ctx.workspace,
    model: ctx.model,
    tools: ctx.tools,
  });
  ctx.debug("lifecycle.agent.reconfigured", {
    from_mode: previousMode,
    to_mode: ctx.mode,
    from_model: previousModel,
    to_model: ctx.model,
    provider: resolved.provider,
  });
}

export function createLifecycleFeedbackText(feedback: LifecycleFeedback): string {
  const lines = [`SYSTEM: Lifecycle feedback (${feedback.source}):`, feedback.summary];
  if (feedback.details) lines.push("", feedback.details);
  if (feedback.instruction) lines.push("", feedback.instruction);
  return lines.join("\n");
}

function createGenerationInputFromFeedback(baseAgentInput: string, activeFeedback: LifecycleFeedback[]): string {
  if (activeFeedback.length === 0) return baseAgentInput;
  return [baseAgentInput, ...activeFeedback.map(createLifecycleFeedbackText)].join("\n\n");
}

export function consumeLifecycleFeedback(
  state: Pick<LifecycleState, "feedback">,
  mode: RunContext["mode"],
): LifecycleFeedback[] {
  const activeFeedback = state.feedback.filter((feedback) => feedback.mode === mode);
  if (activeFeedback.length === 0) return [];
  state.feedback = state.feedback.filter((feedback) => feedback.mode !== mode);
  return activeFeedback;
}

export function createGenerationInput(
  ctx: Pick<RunContext, "baseAgentInput" | "mode"> & { lifecycleState: Pick<LifecycleState, "feedback"> },
): string {
  const activeFeedback = ctx.lifecycleState.feedback.filter((feedback) => feedback.mode === ctx.mode);
  return createGenerationInputFromFeedback(ctx.baseAgentInput, activeFeedback);
}

export async function phaseGenerate(ctx: RunContext, opts: GenerateOptions): Promise<void> {
  ctx.currentError = undefined;
  ctx.sawEditFileMultiMatchError = false;
  ensureAgentForMode(ctx);
  resetCycleStepCount(ctx.session, opts.cycleLimit);
  ctx.generationAttempt += 1;
  const activeFeedback = consumeLifecycleFeedback(ctx.lifecycleState, ctx.mode);
  const prompt = createGenerationInputFromFeedback(ctx.baseAgentInput, activeFeedback);
  ctx.emit({ type: "status", message: `${agentModes[ctx.mode].statusText} (${ctx.model})` });
  ctx.emit({
    type: "usage",
    promptTokens: ctx.promptTokensAccum || ctx.promptUsage.promptTokens,
    completionTokens: ctx.completionTokensAccum,
  });
  ctx.debug("lifecycle.generate.start", {
    model: ctx.model,
    mode: ctx.mode,
    cycle_limit: opts.cycleLimit ?? null,
  });

  try {
    const preCallCount = ctx.modelCallCount;
    ctx.result = await streamWithTimeout(ctx, prompt, opts.timeoutMs);
    if (ctx.modelCallCount === preCallCount) {
      ctx.modelCallCount += 1;
      ctx.completionTokensAccum += estimateTokens(ctx.result.text);
    }
    if (ctx.promptTokensAccum === 0) {
      ctx.promptTokensAccum = ctx.promptUsage.promptTokens;
    }
    ctx.streamingChars = 0;
    ctx.lastUsageEmitChars = 0;
    ctx.emit({
      type: "usage",
      promptTokens: ctx.promptTokensAccum,
      completionTokens: ctx.completionTokensAccum,
    });
    ctx.debug("lifecycle.generate.done", {
      model: ctx.model,
      tool_calls: ctx.result.toolCalls.length,
      text_chars: ctx.result.text.trim().length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode =
      error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
    captureError(ctx, errorMsg, { source: "generate", code: errorCode });
    ctx.debug("lifecycle.generate.error", { model: ctx.model, error: errorMsg });
  }
}

async function streamWithTimeout(ctx: RunContext, prompt: string, timeoutMs: number): Promise<GenerateResult> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const abort = new AbortController();

  const resetTimeout = () => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      const err = new Error(`Step timed out after ${timeoutMs}ms of inactivity`);
      (err as Error & { code: string }).code = LIFECYCLE_ERROR_CODES.timeout;
      abort.abort(err);
    }, timeoutMs);
  };

  try {
    resetTimeout();
    const temperature = appConfig.temperatures[ctx.mode];
    const streamOutput = await ctx.agent.stream(prompt, {
      toolChoice: "auto",
      ...(typeof temperature === "number" ? { temperature } : {}),
      maxNudges: ctx.policy.maxNudgesPerGeneration,
    });
    const reader = streamOutput.fullStream.getReader();
    while (true) {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true });
          if (abort.signal.aborted) reject(abort.signal.reason);
        }),
      ]);
      if (result.done) break;
      const chunk = result.value;
      resetTimeout();
      if (chunk.type === "tool-error") {
        const p = chunk.payload;
        if (!p?.toolName && !p?.toolCallId) {
          const parsed = parseErrorInfo(p?.error ?? p?.message);
          throw new Error(parsed.ok ? parsed.value.message : "Model stream error");
        }
      }
      processStreamChunk(ctx, chunk);
    }
    return (await streamOutput.getFullOutput()) as GenerateResult;
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
    promptTokens: ctx.promptTokensAccum || ctx.promptUsage.promptTokens,
    completionTokens: ctx.completionTokensAccum,
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
      promptTokens: ctx.promptTokensAccum || ctx.promptUsage.promptTokens,
      completionTokens: ctx.completionTokensAccum + streamingTokens,
    });
  }
}

function processStreamChunk(ctx: RunContext, chunk: StreamChunk): void {
  switch (chunk.type) {
    case "text-delta": {
      const p = chunk.payload;
      if (typeof p?.text === "string" && p.text.length > 0) {
        if (ctx.mode !== "verify") ctx.emit({ type: "text-delta", text: p.text });
        emitStreamingUsage(ctx, p.text.length);
      }
      break;
    }
    case "reasoning-delta": {
      const p = chunk.payload;
      if (typeof p?.text === "string" && p.text.length > 0) {
        ctx.emit({ type: "reasoning", text: p.text });
        emitStreamingUsage(ctx, p.text.length);
      }
      break;
    }
    case "tool-call": {
      const p = chunk.payload;
      if (p?.toolCallId && p?.toolName) {
        const toolName = p.toolName;
        ctx.observedTools.add(toolName);
        ctx.toolCallStartedAt.set(p.toolCallId, { toolName, startedAtMs: Date.now() });
        const args = (p.args ?? {}) as Record<string, unknown>;
        ctx.debug("lifecycle.tool.call", { tool: toolName, ...formatToolArgs(args) });

        let queue = ctx.nativeIdQueue.get(toolName);
        if (!queue) {
          queue = [];
          ctx.nativeIdQueue.set(toolName, queue);
        }
        queue.push(p.toolCallId);

        ctx.emit({ type: "tool-call", toolCallId: p.toolCallId, toolName, args });
      }
      break;
    }
    case "tool-result": {
      const p = chunk.payload;
      if (p?.toolCallId && p?.toolName) {
        const toolName = p.toolName;
        completeToolCall(ctx, p.toolCallId, toolName);
        const queue = ctx.nativeIdQueue.get(toolName);
        if (queue?.[queue.length - 1] === p.toolCallId) queue.pop();
        const resultRecord =
          typeof p.result === "object" && p.result !== null ? (p.result as Record<string, unknown>) : null;
        const isError = Boolean(resultRecord && "error" in resultRecord);
        if (isError) {
          const parsed = parseErrorInfo(resultRecord?.error);
          const errorInfo = parsed.ok ? parsed.value : { message: "Tool error" };
          const resultCode = typeof resultRecord?.code === "string" ? resultRecord.code : undefined;
          captureError(ctx, errorInfo.message, {
            source: "tool-result",
            tool: toolName,
            code: resultCode ?? errorInfo.code,
            kind: errorInfo.kind,
          });
          ctx.debug("lifecycle.tool.error", { tool: toolName, error: errorInfo.message });
        }
        emitToolResult(ctx, p.toolCallId, toolName, isError);
      }
      break;
    }
    case "tool-error": {
      const p = chunk.payload;
      const raw = p?.error ?? p?.message;
      const parsed = parseErrorInfo(raw);
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
      break;
    }
    case "model-usage": {
      const p = chunk.payload;
      if (typeof p?.inputTokens === "number") ctx.promptTokensAccum += p.inputTokens;
      if (typeof p?.outputTokens === "number") ctx.completionTokensAccum += p.outputTokens;
      ctx.modelCallCount += 1;
      ctx.emit({
        type: "usage",
        promptTokens: ctx.promptTokensAccum,
        completionTokens: ctx.completionTokensAccum,
      });
      break;
    }
  }
}
