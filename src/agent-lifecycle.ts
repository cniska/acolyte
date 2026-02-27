import type { Agent } from "@mastra/core/agent";
import {
  canonicalToolId,
  createAgentInput,
  createInstructions,
  createModeInstructions,
  createSubagentContext,
  estimateTokens,
  finalizeAssistantOutput,
  finalizeReviewOutput,
  isPlanLikeOutput,
  resolveRunnableModel,
} from "./agent";
import { createAgent } from "./agent-factory";
import { type AgentMode, agentModes, classifyMode, modeForTool } from "./agent-modes";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import type { StreamEvent } from "./client";
import { toolsForAgent } from "./mastra-tools";
import type { SessionContext } from "./tool-guards";

const INITIAL_MAX_STEPS = 50;
const TIMEOUT_RECOVERY_MAX_STEPS = 8;
const TIMEOUT_RECOVERY_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 120_000;
const VERIFY_MAX_STEPS = 30;
const WRITE_TOOLS = ["edit-code", "edit-file", "create-file"];
const DISCOVERY_TOOLS = ["find-files", "search-files", "read-file", "scan-code", "git-status", "git-diff"];

export type GenerateResult = {
  text: string;
  toolCalls: unknown[];
};

export type EvalAction =
  | { type: "done" }
  | {
      type: "regenerate";
      prompt: string;
      mode?: AgentMode;
      maxSteps?: number;
      timeoutMs?: number;
      keepResult?: boolean;
    };

export type Evaluator = {
  id: string;
  evaluate: (ctx: RunContext) => EvalAction;
};

export type LifecycleInput = {
  request: ChatRequest;
  soulPrompt: string;
  workspace?: string;
  onEvent?: (event: StreamEvent) => void;
  onDebug?: (event: string, fields?: Record<string, unknown>) => void;
};

export type RunContext = {
  readonly request: ChatRequest;
  readonly workspace: string | undefined;
  readonly soulPrompt: string;
  readonly emit: (event: StreamEvent) => void;
  readonly debug: (event: string, fields?: Record<string, unknown>) => void;
  readonly classifiedMode: AgentMode;
  readonly model: string;
  readonly session: SessionContext;
  readonly agent: Agent;
  readonly agentInput: string;
  readonly memoryOptions?: { thread: string; resource: string };
  readonly promptUsage: {
    promptTokens: number;
    promptBudgetTokens: number;
    promptTruncated: boolean;
    includedHistoryMessages: number;
    totalHistoryMessages: number;
  };
  mode: AgentMode;
  observedTools: Set<string>;
  modelCallCount: number;
  lastError?: string;
  result?: GenerateResult;
  nativeIdQueue: Map<string, string[]>;
  toolCallStartedAt: Map<string, { toolName: string; startedAtMs: number }>;
  toolOutputHandler: ((event: { toolName: string; message: string; toolCallId?: string }) => void) | null;
};

// --- Helpers ---

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

function isReviewRequest(text: string): boolean {
  return /\breview\b/i.test(text);
}

function emitModeStatus(ctx: RunContext): void {
  ctx.emit({ type: "status", message: `${agentModes[ctx.mode].statusText} (${ctx.model})` });
}

// --- Evaluators ---

export const planDetector: Evaluator = {
  id: "plan-detector",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (isPlanLikeOutput(ctx.result.text.trim()) && ctx.observedTools.size === 0) {
      ctx.debug("lifecycle.eval.plan_detected", { text_chars: ctx.result.text.trim().length });
      return {
        type: "regenerate",
        prompt: `${ctx.agentInput}\n\nExecute the task directly using tools. Do not describe a plan or ask for confirmation.`,
      };
    }
    return { type: "done" };
  },
};

export const autoVerifier: Evaluator = {
  id: "auto-verifier",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    const usedWriteTools = WRITE_TOOLS.some((t) => ctx.observedTools.has(t));
    if (ctx.classifiedMode === "work" && usedWriteTools && !ctx.session.flags.verifyRan) {
      return {
        type: "regenerate",
        prompt: createModeInstructions("verify", ctx.workspace),
        mode: "verify",
        maxSteps: VERIFY_MAX_STEPS,
        keepResult: true,
      };
    }
    return { type: "done" };
  },
};

export const efficiencyEvaluator: Evaluator = {
  id: "efficiency-evaluator",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.classifiedMode !== "work") return { type: "done" };

    const callLog = ctx.session.callLog;
    const firstWriteIndex = callLog.findIndex((entry) => WRITE_TOOLS.includes(entry.toolName));
    if (firstWriteIndex >= 0) return { type: "done" };

    const discoveryCalls = callLog.filter((entry) => DISCOVERY_TOOLS.includes(entry.toolName)).length;
    if (discoveryCalls < 3) return { type: "done" };

    ctx.debug("lifecycle.eval.efficiency_regenerate", { discovery_calls: discoveryCalls });
    return {
      type: "regenerate",
      prompt:
        `${ctx.agentInput}\n\n` +
        "You already have enough context. Do not run find/search/read again unless absolutely required. " +
        "Proceed directly with file edits, then run verify.",
    };
  },
};

// --- Phase: Classify ---

function phaseClassify(request: ChatRequest, debug: RunContext["debug"]): { classifiedMode: AgentMode; model: string } {
  const classifiedMode = classifyMode(request.message);
  const requestedModel = appConfig.models[classifiedMode] ?? request.model;
  const resolved = resolveRunnableModel(requestedModel);
  if (!resolved.available) {
    throw new Error(
      `Provider '${resolved.provider}' is not configured for model '${resolved.model}'. ` +
        "Set the API key in your config or environment, or switch to another model.",
    );
  }
  debug("lifecycle.classify", { mode: classifiedMode, model: resolved.model });
  return { classifiedMode, model: resolved.model };
}

// --- Phase: Prepare ---

function phasePrepare(input: {
  request: ChatRequest;
  workspace: string | undefined;
  soulPrompt: string;
  classifiedMode: AgentMode;
  model: string;
  debug: RunContext["debug"];
  onToolOutput: (event: { toolName: string; message: string; toolCallId?: string }) => void;
}): {
  session: SessionContext;
  agent: Agent;
  agentInput: string;
  memoryOptions: { thread: string; resource: string } | undefined;
  promptUsage: RunContext["promptUsage"];
} {
  const requestInput = createAgentInput(input.request);
  const subagentContext = createSubagentContext(input.request);
  const agentInput = `${subagentContext}\n\n${requestInput.input}`;

  const resourceId = input.request.resourceId?.trim() || appConfig.memory.resourceId;
  const memoryOptions =
    input.request.useMemory && input.request.sessionId
      ? { thread: input.request.sessionId, resource: resourceId }
      : undefined;

  const { tools, session } = toolsForAgent({
    workspace: input.workspace,
    onToolOutput: input.onToolOutput,
  });

  session.onGuard = (event) => {
    input.debug("lifecycle.guard", {
      guard: event.guardId,
      tool: event.toolName,
      action: event.action,
      detail: event.detail,
    });
  };

  const agent = createAgent({
    id: "acolyte",
    name: "Acolyte",
    model: input.model,
    instructions: createInstructions(input.soulPrompt, input.classifiedMode, input.workspace),
    tools,
  });

  input.debug("lifecycle.prepare", {
    model: input.model,
    mode: input.classifiedMode,
    history_messages: input.request.history.length,
    has_memory: Boolean(memoryOptions),
  });

  return { session, agent, agentInput, memoryOptions, promptUsage: requestInput.usage };
}

// --- Phase: Generate ---

async function phaseGenerate(
  ctx: RunContext,
  prompt: string,
  opts: { maxSteps: number; timeoutMs: number },
): Promise<void> {
  emitModeStatus(ctx);
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
    ctx.lastError = error instanceof Error ? error.message : String(error);
    ctx.emit({ type: "error", error: `Tool failed: ${ctx.lastError}` });
    ctx.debug("lifecycle.generate.error", { model: ctx.model, error: ctx.lastError });

    if (/timed out/i.test(ctx.lastError)) {
      emitModeStatus(ctx);
      ctx.debug("lifecycle.generate.retry", {
        model: ctx.model,
        reason: "timeout_recovery",
        max_steps: TIMEOUT_RECOVERY_MAX_STEPS,
      });
      try {
        ctx.modelCallCount += 1;
        ctx.result = await streamWithTimeout(ctx, prompt, TIMEOUT_RECOVERY_MAX_STEPS, TIMEOUT_RECOVERY_TIMEOUT_MS);
        ctx.debug("lifecycle.generate.done", {
          model: ctx.model,
          reason: "timeout_recovery",
          tool_calls: ctx.result.toolCalls.length,
          text_chars: ctx.result.text.trim().length,
        });
      } catch (retryError) {
        ctx.lastError = retryError instanceof Error ? retryError.message : String(retryError);
        ctx.emit({ type: "error", error: `Retry failed: ${ctx.lastError}` });
        ctx.debug("lifecycle.generate.retry_failed", { model: ctx.model, error: ctx.lastError });
      }
    }
  }
}

// --- Stream processing ---

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

    ctx.agent
      .stream(prompt, {
        maxSteps,
        toolChoice: "auto",
        memory: ctx.memoryOptions,
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

function processStreamChunk(ctx: RunContext, chunk: { type?: string; payload?: unknown }): void {
  switch (chunk.type) {
    case "text-delta": {
      const p = chunk.payload as { text?: string } | undefined;
      if (typeof p?.text === "string" && p.text.length > 0 && ctx.mode !== "verify") {
        ctx.emit({ type: "text-delta", text: p.text });
      }
      break;
    }
    case "reasoning-delta": {
      const p = chunk.payload as { text?: string } | undefined;
      if (typeof p?.text === "string" && p.text.length > 0) {
        ctx.emit({ type: "reasoning", text: p.text });
      }
      break;
    }
    case "tool-call": {
      const p = chunk.payload as
        | {
            toolCallId?: string;
            toolName?: string;
            args?: Record<string, unknown>;
          }
        | undefined;
      if (p?.toolCallId && p?.toolName) {
        const toolName = canonicalToolId(p.toolName);
        ctx.observedTools.add(toolName);
        ctx.toolCallStartedAt.set(p.toolCallId, { toolName, startedAtMs: Date.now() });
        if (ctx.mode !== "verify") {
          const inferredMode = modeForTool(toolName);
          // Only escalate (plan → work), never de-escalate
          if (inferredMode === "work" && ctx.mode === "plan") {
            ctx.mode = "work";
            ctx.debug("lifecycle.mode.changed", { from: "plan", to: "work", trigger: toolName });
            emitModeStatus(ctx);
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
      const p = chunk.payload as
        | {
            toolCallId?: string;
            toolName?: string;
            result?: unknown;
          }
        | undefined;
      if (p?.toolCallId && p?.toolName) {
        const toolName = canonicalToolId(p.toolName);
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
        if (queue?.[queue.length - 1] === p.toolCallId) {
          queue.pop();
        }
        const isError =
          typeof p.result === "object" && p.result !== null && "error" in (p.result as Record<string, unknown>);
        if (isError) {
          ctx.lastError = String((p.result as { error?: unknown }).error ?? "Tool error");
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
          ...(isError ? { isError: true } : {}),
        });
      }
      break;
    }
    case "tool-error": {
      const p = chunk.payload as
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
      ctx.lastError = errorMsg;
      ctx.debug("lifecycle.tool.error", { error: errorMsg });
      if (p?.toolCallId && p?.toolName) {
        const started = ctx.toolCallStartedAt.get(p.toolCallId);
        const durationMs = started ? Date.now() - started.startedAtMs : null;
        ctx.debug("lifecycle.tool.result", {
          tool: canonicalToolId(p.toolName),
          tool_call_id: p.toolCallId,
          duration_ms: durationMs,
          is_error: true,
        });
        ctx.toolCallStartedAt.delete(p.toolCallId);
        ctx.emit({
          type: "tool-result",
          toolCallId: p.toolCallId,
          toolName: canonicalToolId(p.toolName),
          isError: true,
        });
      }
      break;
    }
  }
}

// --- Phase: Finalize ---

function phaseFinalize(ctx: RunContext): ChatResponse {
  const rawOutput = ctx.result?.text.trim() ?? "";
  const output = isReviewRequest(ctx.request.message)
    ? finalizeReviewOutput(rawOutput, ctx.request.message)
    : finalizeAssistantOutput(rawOutput, ctx.request.message, ctx.observedTools.size, ctx.lastError);

  const completionTokens = estimateTokens(output);
  let budgetWarning: string | undefined;
  if (ctx.promptUsage.promptTruncated) {
    budgetWarning = `context trimmed (${ctx.promptUsage.includedHistoryMessages}/${ctx.promptUsage.totalHistoryMessages} history messages)`;
  } else if (ctx.promptUsage.promptTokens >= Math.floor(ctx.promptUsage.promptBudgetTokens * 0.9)) {
    budgetWarning = `context near budget (${ctx.promptUsage.promptTokens}/${ctx.promptUsage.promptBudgetTokens} tokens)`;
  }

  ctx.debug("lifecycle.summary", {
    mode: ctx.classifiedMode,
    model: ctx.model,
    model_calls: ctx.modelCallCount,
    tool_calls: ctx.observedTools.size,
    tools: Array.from(ctx.observedTools).join(","),
    has_error: Boolean(ctx.lastError),
    output_chars: output.length,
    budget_warning: budgetWarning ?? null,
  });

  return {
    model: ctx.model,
    output,
    toolCalls: Array.from(ctx.observedTools),
    modelCalls: ctx.modelCallCount,
    usage: {
      promptTokens: ctx.promptUsage.promptTokens,
      completionTokens,
      totalTokens: ctx.promptUsage.promptTokens + completionTokens,
      promptBudgetTokens: ctx.promptUsage.promptBudgetTokens,
      promptTruncated: ctx.promptUsage.promptTruncated,
    },
    budgetWarning,
  };
}

// --- Runner ---

export async function runLifecycle(input: LifecycleInput): Promise<ChatResponse> {
  const emit = input.onEvent ?? (() => {});
  const debug: RunContext["debug"] = input.onDebug ?? (() => {});

  const { classifiedMode, model } = phaseClassify(input.request, debug);

  const nativeIdQueue = new Map<string, string[]>();
  const toolCallStartedAt = new Map<string, { toolName: string; startedAtMs: number }>();
  let toolOutputHandler: RunContext["toolOutputHandler"] = null;

  const prepared = phasePrepare({
    request: input.request,
    workspace: input.workspace,
    soulPrompt: input.soulPrompt,
    classifiedMode,
    model,
    debug,
    onToolOutput: (event) => {
      toolOutputHandler?.(event);
    },
  });

  const ctx: RunContext = {
    request: input.request,
    workspace: input.workspace,
    soulPrompt: input.soulPrompt,
    emit,
    debug,
    classifiedMode,
    mode: classifiedMode,
    model,
    session: prepared.session,
    agent: prepared.agent,
    agentInput: prepared.agentInput,
    memoryOptions: prepared.memoryOptions,
    promptUsage: prepared.promptUsage,
    observedTools: new Set(),
    modelCallCount: 0,
    nativeIdQueue,
    toolCallStartedAt,
    toolOutputHandler: null,
  };

  toolOutputHandler = (event) => {
    if (!event.message.trim()) return;
    const queue = ctx.nativeIdQueue.get(event.toolName);
    const nativeId = queue?.[queue.length - 1] ?? event.toolCallId ?? event.toolName;
    ctx.emit({
      type: "tool-output",
      toolCallId: nativeId,
      toolName: event.toolName,
      content: event.message,
    });
  };
  ctx.toolOutputHandler = toolOutputHandler;

  ctx.debug("lifecycle.start", { mode: classifiedMode, model });
  await phaseGenerate(ctx, ctx.agentInput, {
    maxSteps: INITIAL_MAX_STEPS,
    timeoutMs: STEP_TIMEOUT_MS,
  });

  if (!ctx.result) return phaseFinalize(ctx);

  const evaluators: Evaluator[] = [planDetector, efficiencyEvaluator, autoVerifier];
  for (const evaluator of evaluators) {
    const action = evaluator.evaluate(ctx);
    if (action.type === "done") {
      ctx.debug("lifecycle.eval.decision", { evaluator: evaluator.id, action: "done" });
      continue;
    }
    const saved: { result: GenerateResult | undefined; lastError: string | undefined } | undefined = action.keepResult
      ? { result: ctx.result, lastError: ctx.lastError }
      : undefined;
    if (action.mode) ctx.mode = action.mode;
    ctx.debug("lifecycle.eval.decision", {
      evaluator: evaluator.id,
      action: "regenerate",
      mode: ctx.mode,
      max_steps: action.maxSteps ?? INITIAL_MAX_STEPS,
      timeout_ms: action.timeoutMs ?? STEP_TIMEOUT_MS,
      keep_result: Boolean(action.keepResult),
    });
    await phaseGenerate(ctx, action.prompt, {
      maxSteps: action.maxSteps ?? INITIAL_MAX_STEPS,
      timeoutMs: action.timeoutMs ?? STEP_TIMEOUT_MS,
    });
    if (saved) {
      ctx.result = saved.result;
      ctx.lastError = saved.lastError;
    }
  }

  return phaseFinalize(ctx);
}
