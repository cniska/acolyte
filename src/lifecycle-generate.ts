import type { Agent } from "./agent-contract";
import { createAgent } from "./agent-factory";
import { createInstructions } from "./agent-instructions";
import { agentModes, modeForTool } from "./agent-modes";
import { appConfig } from "./app-config";
import {
  buildStreamErrorDetail,
  categoryFromErrorCode,
  classifyErrorCategory,
  type ErrorSource,
  errorCodeFromCategory,
  isEditFileMultiMatchSignal,
  parseErrorInfo,
} from "./error-handling";
import { resolveModeModelOrThrow } from "./lifecycle-classify";
import type {
  GenerateOptions,
  GenerateResult,
  RunContext,
  StreamChunk,
  TextDeltaPayload,
  ToolCallPayload,
  ToolErrorPayload,
  ToolResultPayload,
} from "./lifecycle-contract";
import type { StreamErrorDetail } from "./stream-error";
import type { ToolDefinition } from "./tool-contract";
import { extractToolErrorCode, LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import type { Toolset } from "./tool-registry";

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

function captureError(
  ctx: RunContext,
  message: string,
  meta?: { source?: ErrorSource; tool?: string; code?: string },
): void {
  ctx.lastError = message;
  const derivedCategory = classifyErrorCategory(message);
  const code = meta?.code ?? extractToolErrorCode(message) ?? errorCodeFromCategory(derivedCategory);
  ctx.lastErrorCode = code;
  const category = categoryFromErrorCode(code) ?? derivedCategory;
  ctx.lastErrorCategory = category;
  ctx.lastErrorSource = meta?.source;
  ctx.lastErrorTool = meta?.tool;
  ctx.errorStats[category] += 1;
  if (isEditFileMultiMatchSignal({ code, message })) ctx.sawEditFileMultiMatchError = true;
  ctx.debug("lifecycle.error", {
    source: meta?.source ?? "generate",
    tool: meta?.tool ?? null,
    code: code ?? null,
    category,
    message: message.length > 240 ? `${message.slice(0, 239)}…` : message,
  });
}

function currentErrorDetail(ctx: RunContext): StreamErrorDetail | undefined {
  if (!ctx.lastError) return undefined;
  return buildStreamErrorDetail(
    {
      message: ctx.lastError,
      code: ctx.lastErrorCode,
      source: ctx.lastErrorSource,
      tool: ctx.lastErrorTool,
      unknownErrorCount: ctx.errorStats.other,
    },
    ctx.policy.maxUnknownErrorsPerRequest,
  ).errorDetail;
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

function ensureAgentForMode(ctx: RunContext): void {
  const resolved = resolveModeModelOrThrow(ctx.mode, ctx.request.model);
  const nextModel = resolved.model;
  if (ctx.agentMode === ctx.mode && ctx.model === nextModel) return;

  const previousMode = ctx.agentMode;
  const previousModel = ctx.model;
  ctx.model = nextModel;
  ctx.agentMode = ctx.mode;
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

export async function phaseGenerate(ctx: RunContext, prompt: string, opts: GenerateOptions): Promise<void> {
  ctx.lastError = undefined;
  ctx.lastErrorCode = undefined;
  ctx.lastErrorCategory = undefined;
  ctx.lastErrorSource = undefined;
  ctx.lastErrorTool = undefined;
  ctx.sawEditFileMultiMatchError = false;
  ensureAgentForMode(ctx);
  ctx.generationAttempt += 1;
  ctx.emit({ type: "status", message: `${agentModes[ctx.mode].statusText} (${ctx.model})` });
  ctx.debug("lifecycle.generate.start", {
    model: ctx.model,
    mode: ctx.mode,
    max_steps: opts.maxSteps,
  });

  try {
    ctx.modelCallCount += 1;
    ctx.result = await streamWithTimeout(ctx, prompt, opts.maxSteps, opts.timeoutMs);
    ctx.debug("lifecycle.generate.done", {
      model: ctx.model,
      tool_calls: ctx.result.toolCalls.length,
      text_chars: ctx.result.text.trim().length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const timeoutCode = /timed out/i.test(errorMsg) ? LIFECYCLE_ERROR_CODES.timeout : undefined;
    captureError(ctx, errorMsg, { source: "generate", code: timeoutCode });
    ctx.emit({
      type: "error",
      error: `Tool failed: ${ctx.lastError}`,
      ...(ctx.lastErrorCode ? { errorCode: ctx.lastErrorCode } : {}),
      ...(currentErrorDetail(ctx) ? { errorDetail: currentErrorDetail(ctx) } : {}),
    });
    ctx.debug("lifecycle.generate.error", { model: ctx.model, error: ctx.lastError });
  }
}

async function streamWithTimeout(
  ctx: RunContext,
  prompt: string,
  maxSteps: number,
  timeoutMs: number,
): Promise<GenerateResult> {
  return await new Promise<GenerateResult>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const resetTimeout = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Step timed out after ${timeoutMs}ms of inactivity`));
      }, timeoutMs);
    };
    resetTimeout();
    const temperature = appConfig.temperatures[ctx.mode];

    ctx.agent
      .stream(prompt, {
        maxSteps,
        toolChoice: "auto",
        ...(typeof temperature === "number" ? { temperature } : {}),
      })
      .then(async (streamOutput) => {
        const reader = streamOutput.fullStream.getReader();
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (!chunk || typeof chunk !== "object") continue;
          const typed = chunk as { type?: string; payload?: unknown };
          resetTimeout();
          processStreamChunk(ctx, typed);
          if (typed.type === "tool-error") {
            const p = typed.payload as ToolErrorPayload | undefined;
            const hasToolContext = Boolean(p?.toolName || p?.toolCallId);
            if (!hasToolContext) {
              const parsed = parseErrorInfo(p?.error ?? p?.message);
              const modelError = parsed.ok ? parsed.value.message : "Model stream error";
              throw new Error(modelError);
            }
          }
        }
        return await streamOutput.getFullOutput();
      })
      .then((value) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        resolve(value as GenerateResult);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function processStreamChunk(ctx: RunContext, chunk: StreamChunk): void {
  switch (chunk.type) {
    case "text-delta": {
      const p = chunk.payload as TextDeltaPayload | undefined;
      if (typeof p?.text === "string" && p.text.length > 0 && ctx.mode !== "verify")
        ctx.emit({ type: "text-delta", text: p.text });
      break;
    }
    case "reasoning-delta": {
      const p = chunk.payload as TextDeltaPayload | undefined;
      if (typeof p?.text === "string" && p.text.length > 0) ctx.emit({ type: "reasoning", text: p.text });
      break;
    }
    case "tool-call": {
      const p = chunk.payload as ToolCallPayload | undefined;
      if (p?.toolCallId && p?.toolName) {
        const toolName = p.toolName;
        ctx.observedTools.add(toolName);
        ctx.toolCallStartedAt.set(p.toolCallId, { toolName, startedAtMs: Date.now() });
        if (ctx.mode !== "verify") {
          const inferredMode = modeForTool(toolName);
          if (inferredMode === "work" && ctx.mode === "plan") {
            const fromMode = ctx.mode;
            ctx.mode = "work";
            ctx.debug("lifecycle.mode.changed", { from: fromMode, to: "work", trigger: toolName });
            ctx.emit({ type: "status", message: `${agentModes[ctx.mode].statusText} (${ctx.model})` });
          }
        }
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
      const p = chunk.payload as ToolResultPayload | undefined;
      if (p?.toolCallId && p?.toolName) {
        const toolName = p.toolName;
        const started = ctx.toolCallStartedAt.get(p.toolCallId);
        if (started) {
          const durationMs = Date.now() - started.startedAtMs;
          ctx.debug("lifecycle.tool.result", {
            tool: toolName,
            tool_call_id: p.toolCallId,
            duration_ms: durationMs,
            is_error: false,
          });
          ctx.toolCallStartedAt.delete(p.toolCallId);
        }
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
          });
          ctx.debug("lifecycle.tool.error", { tool: toolName, error: ctx.lastError });
          ctx.debug("lifecycle.tool.result", {
            tool: toolName,
            tool_call_id: p.toolCallId,
            is_error: true,
          });
        }
        ctx.emit({
          type: "tool-result",
          toolCallId: p.toolCallId,
          toolName,
          ...(isError
            ? {
                isError: true,
                ...(ctx.lastErrorCode ? { errorCode: ctx.lastErrorCode } : {}),
                ...(currentErrorDetail(ctx) ? { errorDetail: currentErrorDetail(ctx) } : {}),
              }
            : {}),
        });
      }
      break;
    }
    case "tool-error": {
      const p = chunk.payload as ToolErrorPayload | undefined;
      const raw = p?.error ?? p?.message;
      const parsed = parseErrorInfo(raw);
      const errorInfo = parsed.ok ? parsed.value : { message: "Tool error" };
      const payloadCode = typeof p?.code === "string" ? p.code : undefined;
      const errorMsg = errorInfo.message;
      const toolName = p?.toolName ?? "";
      captureError(ctx, errorMsg, { source: "tool-error", tool: toolName, code: payloadCode ?? errorInfo.code });
      ctx.debug("lifecycle.tool.error", { tool: toolName, error: errorMsg });
      if (p?.toolCallId && p?.toolName) {
        const started = ctx.toolCallStartedAt.get(p.toolCallId);
        const durationMs = started ? Date.now() - started.startedAtMs : null;
        ctx.debug("lifecycle.tool.result", {
          tool: p.toolName,
          tool_call_id: p.toolCallId,
          duration_ms: durationMs,
          is_error: true,
        });
        ctx.toolCallStartedAt.delete(p.toolCallId);
        ctx.emit({
          type: "tool-result",
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          isError: true,
          ...(ctx.lastErrorCode ? { errorCode: ctx.lastErrorCode } : {}),
          ...(currentErrorDetail(ctx) ? { errorDetail: currentErrorDetail(ctx) } : {}),
        });
      }
      break;
    }
  }
}
