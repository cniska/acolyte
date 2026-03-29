import type { Agent } from "./agent-contract";
import { estimateTokens } from "./agent-input";
import { createInstructions } from "./agent-instructions";
import { agentModes } from "./agent-modes";
import { createAgent } from "./agent-stream";
import { appConfig } from "./app-config";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import {
  categoryFromErrorCode,
  categoryFromErrorKind,
  createStreamError,
  type ErrorSource,
  errorCodeFromCategory,
  errorKindFromCategory,
  parseError,
} from "./error-handling";
import type {
  GenerateOptions,
  GenerateResult,
  LifecycleFeedback,
  LifecycleState,
  RunContext,
  StreamChunk,
} from "./lifecycle-contract";
import { resolveModeModel } from "./lifecycle-resolve";
import { addPromptBreakdownTotals, estimatePromptBreakdown, totalPromptBreakdownTokens } from "./lifecycle-usage";
import { formatModel } from "./provider-config";
import type { StreamError } from "./stream-error";
import { extractToolTargetPaths } from "./tool-arg-paths";
import type { ToolDefinition } from "./tool-contract";
import { extractToolErrorCode } from "./tool-error";
import { resetCycleStepCount } from "./tool-guards";
import type { Toolset } from "./tool-registry";

type CaptureErrorMeta = {
  source?: ErrorSource;
  tool?: string;
  code?: string;
  kind?: string;
  recovery?: NonNullable<RunContext["currentError"]>["recovery"];
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
  return Math.max(ctx.inputTokensAccum, totalPromptBreakdownTokens(ctx.promptBreakdownTotals));
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
  ctx.currentError = { message, code, category, source: meta?.source, tool: meta?.tool, recovery: meta?.recovery };
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
  const allowedTools = new Set(agentModes[input.mode].tools);
  const filteredTools: Record<string, ToolDefinition> = {};
  for (const [key, tool] of Object.entries(input.tools as Record<string, ToolDefinition>)) {
    if (allowedTools.has(tool.id)) filteredTools[key] = tool;
  }
  return createAgent({
    model: input.model,
    instructions: createInstructions(input.soulPrompt, input.mode, input.workspace),
    tools: filteredTools,
  });
}

function ensureAgentForMode(ctx: RunContext): void {
  if (ctx.agentForMode === ctx.mode) return;

  const resolved = resolveModeModel(ctx.mode, ctx.request.model, ctx.request.modeModels);
  const nextModel = resolved.model;

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
): LifecycleFeedback[] {
  const activeFeedback = [...state.feedback];
  if (activeFeedback.length === 0) return [];
  state.feedback = [];
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
  ensureAgentForMode(ctx);
  resetCycleStepCount(ctx.session, opts.cycleLimit);
  ctx.generationAttempt += 1;
  const activeFeedback = consumeLifecycleFeedback(ctx.lifecycleState);
  const prompt = createGenerationInputFromFeedback(ctx.baseAgentInput, activeFeedback);
  addPromptBreakdownTotals(ctx.promptBreakdownTotals, estimatePromptBreakdown(prompt, ctx.promptUsage));
  ctx.emit({ type: "status", state: { kind: "running", mode: ctx.mode, model: formatModel(ctx.model) } });
  ctx.emit({
    type: "usage",
    inputTokens: emitInputTokens(ctx),
    outputTokens: ctx.outputTokensAccum,
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode =
      error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
    captureError(ctx, errorMsg, { source: "generate", code: errorCode });
    ctx.debug("lifecycle.generate.error", { model: ctx.model, error: errorMsg });
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
    const temperature = ctx.temperatures?.[ctx.mode] ?? appConfig.temperatures[ctx.mode];
    const streamOutput = await ctx.agent.stream(prompt, {
      toolChoice: "auto",
      ...(typeof temperature === "number" ? { temperature } : {}),
      maxNudges: ctx.policy.maxNudgesPerGeneration,
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

function didResolveToolRecovery(
  recovery: NonNullable<RunContext["currentError"]>["recovery"],
  started: { toolName: string; targetPaths?: string[] },
): boolean {
  if (!recovery?.resolvesOn || recovery.resolvesOn.length === 0) return false;
  const targets = started.targetPaths ?? [];
  return recovery.resolvesOn.some((resolution) => {
    if (resolution.tool !== started.toolName) return false;
    if (!resolution.targetPaths || resolution.targetPaths.length === 0) return true;
    return resolution.targetPaths.every((targetPath) => targets.includes(targetPath));
  });
}

function clearResolvedToolError(ctx: RunContext, started: { toolName: string; targetPaths?: string[] }): void {
  if (!ctx.currentError) return;
  if (ctx.currentError.source !== "tool-error" && ctx.currentError.source !== "tool-result") return;
  const failedTool = ctx.currentError.tool;
  if (!failedTool) return;
  if (failedTool === started.toolName) {
    ctx.currentError = undefined;
    return;
  }
  if (!didResolveToolRecovery(ctx.currentError.recovery, started)) return;
  ctx.currentError = undefined;
}

function processStreamChunk(ctx: RunContext, chunk: StreamChunk): void {
  switch (chunk.type) {
    case "text-delta": {
      const p = chunk.payload;
      if (typeof p?.text === "string" && p.text.length > 0) {
        ctx.emit({ type: "text-delta", text: p.text });
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
        const args = (p.args ?? {}) as Record<string, unknown>;
        ctx.toolCallStartedAt.set(p.toolCallId, {
          toolName,
          startedAtMs: Date.now(),
          targetPaths: extractToolTargetPaths(args, toolName),
        });
        ctx.debug("lifecycle.tool.call", { tool: toolName, ...formatToolArgs(args) });

        ctx.emit({ type: "tool-call", toolCallId: p.toolCallId, toolName, args });
      }
      break;
    }
    case "tool-result": {
      const p = chunk.payload;
      if (p?.toolCallId && p?.toolName) {
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
            recovery: errorInfo.recovery,
          });
          ctx.debug("lifecycle.tool.error", { tool: toolName, error: errorInfo.message });
        } else {
          clearResolvedToolError(ctx, started ?? { toolName });
        }
        completeToolCall(ctx, p.toolCallId, toolName);
        emitToolResult(ctx, p.toolCallId, toolName, isError);
      }
      break;
    }
    case "tool-error": {
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
        recovery: errorInfo.recovery,
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
      if (typeof p?.inputTokens === "number") ctx.inputTokensAccum += p.inputTokens;
      if (typeof p?.outputTokens === "number") ctx.outputTokensAccum += p.outputTokens;
      ctx.modelCallCount += 1;
      ctx.emit({
        type: "usage",
        inputTokens: ctx.inputTokensAccum,
        outputTokens: ctx.outputTokensAccum,
      });
      break;
    }
  }
}
