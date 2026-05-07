import { invariant } from "./assert";
import { ERROR_KINDS, errorMessage, LIFECYCLE_ERROR_CODES } from "./error-contract";
import { parseError } from "./error-handling";
import { field } from "./field";
import type {
  EffectOutput,
  PostToolContext,
  PreToolContext,
  RunToolResult,
  SessionContext,
  ToolCache,
  ToolCacheEntry,
} from "./tool-contract";
import { ToolError } from "./tool-error";
import { checkStepBudget, recordCall } from "./tool-session";

function withTimeout<T>(task: () => Promise<T>, timeoutMs: number, toolId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new ToolError(LIFECYCLE_ERROR_CODES.timeout, `${toolId} timed out after ${timeoutMs}ms`, ERROR_KINDS.timeout),
        ),
      timeoutMs,
    );
    task().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function hashResultValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length > 10_000) return undefined;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(str);
  return hasher.digest("hex").slice(0, 16);
}

function extractExitCode(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const exitCode = (value as { exitCode?: unknown }).exitCode;
  return typeof exitCode === "number" && Number.isInteger(exitCode) ? exitCode : undefined;
}

type ToolRunInput<T> = {
  session: SessionContext;
  toolId: string;
  toolCallId: string;
  args: Record<string, unknown>;
  execute: (toolCallId: string) => Promise<T>;
  options?: { timeoutMs?: number; skipStepBudget?: boolean };
};

type BeforeToolResult = {
  preOutput?: EffectOutput;
};

type ToolExecutionResult<T> = {
  result: T;
  taskFailed: boolean;
  taskError?: unknown;
};

function debugSideEffectFailure(
  session: SessionContext,
  phase: "before" | "after",
  toolId: string,
  toolCallId: string,
  error: unknown,
) {
  session.onDebug?.("lifecycle.tool.side_effect_failed", {
    phase,
    tool: toolId,
    tool_call_id: toolCallId,
    message: errorMessage(error),
  });
}

function assertStepBudget(input: Pick<ToolRunInput<unknown>, "session" | "toolId" | "options">): void {
  if (input.options?.skipStepBudget) return;
  const budgetError = checkStepBudget(input.session, input.toolId);
  if (!budgetError) return;
  const error = new Error(budgetError) as Error & { code: string; kind: string };
  error.code = LIFECYCLE_ERROR_CODES.budgetExhausted;
  error.kind = ERROR_KINDS.budgetExhausted;
  throw error;
}

async function runBeforeToolSideEffects(
  input: Pick<ToolRunInput<unknown>, "session" | "toolId" | "toolCallId" | "args">,
): Promise<BeforeToolResult> {
  const ctx: PreToolContext = { toolId: input.toolId, toolCallId: input.toolCallId, args: input.args };
  const preOutput = input.session.onBeforeTool?.(ctx);
  if (input.session.onBeforeToolAsync) {
    try {
      await input.session.onBeforeToolAsync(ctx);
    } catch (error) {
      debugSideEffectFailure(input.session, "before", input.toolId, input.toolCallId, error);
    }
  }
  return { preOutput };
}

async function runAfterToolSideEffects(session: SessionContext, ctx: PostToolContext): Promise<void> {
  if (!session.onAfterToolAsync) return;
  try {
    await session.onAfterToolAsync(ctx);
  } catch (error) {
    debugSideEffectFailure(session, "after", ctx.toolId, ctx.toolCallId, error);
  }
}

function resolveTimeoutMs(session: SessionContext, options?: ToolRunInput<unknown>["options"]): number {
  const timeoutMs = options?.timeoutMs ?? session.toolTimeoutMs;
  invariant(
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0,
    "timeoutMs must be a positive number",
  );
  return timeoutMs;
}

function readCachedResult<T>(
  cache: ToolCache | undefined,
  input: Pick<ToolRunInput<T>, "session" | "toolId" | "toolCallId" | "args">,
): ToolCacheEntry | undefined {
  if (!cache?.isCacheable(input.toolId)) return undefined;
  const cached = cache.get(input.toolId, input.args);
  if (!cached) {
    input.session.onDebug?.("lifecycle.tool.cache", { tool: input.toolId, hit: false, ...cache.stats() });
    return undefined;
  }

  input.session.onDebug?.("lifecycle.tool.cache", { tool: input.toolId, hit: true, ...cache.stats() });
  return cached;
}

function recordToolSuccess<T>(session: SessionContext, toolId: string, args: Record<string, unknown>, result: T): void {
  recordCall(session, toolId, args, hashResultValue(result), "succeeded", {
    exitCode: extractExitCode(result),
  });
}

function recordToolFailure(session: SessionContext, toolId: string, args: Record<string, unknown>): void {
  recordCall(session, toolId, args, undefined, "failed");
}

async function returnCachedResult<T>(
  input: Pick<ToolRunInput<T>, "session" | "toolId" | "toolCallId" | "args">,
  result: T,
): Promise<RunToolResult<T>> {
  await runAfterToolSideEffects(input.session, {
    toolId: input.toolId,
    toolCallId: input.toolCallId,
    args: input.args,
    status: "succeeded",
    result,
  });
  recordToolSuccess(input.session, input.toolId, input.args, result);
  return { result };
}

async function executeToolTask<T>(input: ToolRunInput<T>, timeoutMs: number): Promise<ToolExecutionResult<T>> {
  try {
    const result = await withTimeout(() => input.execute(input.toolCallId), timeoutMs, input.toolId);
    return { result, taskFailed: false };
  } catch (error) {
    return { result: undefined as T, taskFailed: true, taskError: error };
  }
}

async function finalizeExecutedTool<T>(
  input: Pick<ToolRunInput<T>, "session" | "toolId" | "toolCallId" | "args">,
  execution: ToolExecutionResult<T>,
): Promise<void> {
  if (execution.taskFailed) {
    const parsed = parseError(execution.taskError);
    await runAfterToolSideEffects(input.session, {
      toolId: input.toolId,
      toolCallId: input.toolCallId,
      args: input.args,
      status: "failed",
      error: parsed.ok ? parsed.value : { message: `${input.toolId} failed` },
    });
    recordToolFailure(input.session, input.toolId, input.args);
    return;
  }

  await runAfterToolSideEffects(input.session, {
    toolId: input.toolId,
    toolCallId: input.toolCallId,
    args: input.args,
    status: "succeeded",
    result: execution.result,
  });
  recordToolSuccess(input.session, input.toolId, input.args, execution.result);
}

function invalidateCacheAfterWrite(cache: ToolCache | undefined, toolId: string, args: Record<string, unknown>): void {
  if (cache && !cache.isCacheable(toolId)) {
    cache.invalidateForWrite(toolId, args);
  }
}

export async function withToolError<T>(toolId: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const baseMessage = errorMessage(error);
    const wrapped = new Error(`${toolId} failed: ${baseMessage}`) as Error & {
      code?: string;
      kind?: string;
    };
    const code = field(error, "code");
    if (typeof code === "string" && code.length > 0) wrapped.code = code;
    const kind = field(error, "kind");
    if (typeof kind === "string" && kind.length > 0) wrapped.kind = kind;
    throw wrapped;
  }
}

export async function runTool<T = unknown>(
  session: SessionContext,
  toolId: string,
  toolCallId: string,
  args: Record<string, unknown>,
  execute: (toolCallId: string) => Promise<T>,
  options?: { timeoutMs?: number; skipStepBudget?: boolean },
): Promise<RunToolResult<T>> {
  return withToolError(toolId, async () => {
    const input: ToolRunInput<T> = { session, toolId, toolCallId, args, execute, options };
    assertStepBudget(input);
    const { preOutput } = await runBeforeToolSideEffects(input);
    const cache = session.cache;
    const timeoutMs = resolveTimeoutMs(session, options);
    const cached = readCachedResult<T>(cache, input);
    if (cached) return returnCachedResult(input, cached.result as T);

    let execution = await executeToolTask(input, timeoutMs);
    try {
      if (execution.taskFailed) throw execution.taskError;
      if (cache?.isCacheable(toolId)) {
        cache.set(toolId, args, { result: execution.result });
      }
      const postOutput = session.onAfterTool?.({
        toolId,
        toolCallId,
        args: args,
        status: "succeeded",
        result: execution.result,
      });
      const append = [preOutput?.append, postOutput?.append].filter(Boolean).join("\n");
      return { result: execution.result, effectOutput: append || undefined };
    } catch (error) {
      execution = { result: undefined as T, taskFailed: true, taskError: error };
      throw error;
    } finally {
      await finalizeExecutedTool(input, execution);
      if (!execution.taskFailed) invalidateCacheAfterWrite(cache, toolId, args);
    }
  });
}
