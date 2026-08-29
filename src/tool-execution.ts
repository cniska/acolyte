import { invariant } from "./assert";
import { ERROR_KINDS, errorMessage, LIFECYCLE_ERROR_CODES } from "./error-contract";
import { parseError } from "./error-handling";
import { field } from "./field";
import { formatShellCommand } from "./shell-ops";
import type { EffectOutput, PostToolContext, PreToolContext, RunToolResult, SessionContext } from "./tool-contract";
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

// Command-running tools carry the resolved command on their output, not their input args
// (shell-run takes cmd + args[]), so on success the executed command comes from the result.
function extractCommand(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const command = (value as { command?: unknown }).command;
  return typeof command === "string" && command.length > 0 ? command : undefined;
}

// A throwing tool (timeout, spawn failure) produces no result, so the args are the only
// surviving record of what ran — and a command that timed out is exactly the durable fact
// worth keeping. Mirrors shell-run's own display formatting.
function commandFromArgs(args: Record<string, unknown>): string | undefined {
  const cmd = args.cmd;
  if (typeof cmd !== "string" || cmd.length === 0) return undefined;
  const rest = Array.isArray(args.args) ? args.args.filter((a): a is string => typeof a === "string") : [];
  return formatShellCommand({ cmd, args: rest });
}

type ToolRunInput<T> = {
  session: SessionContext;
  toolId: string;
  toolCallId: string;
  args: Record<string, unknown>;
  execute: (toolCallId: string) => Promise<T>;
  options?: { timeoutMs?: number; skipStepBudget?: boolean };
};

type ToolExecutionResult<T> = {
  result: T;
  taskFailed: boolean;
  taskError?: unknown;
};

function debugEffectFailure(
  session: SessionContext,
  phase: "before" | "after",
  toolId: string,
  toolCallId: string,
  error: unknown,
) {
  session.onDebug?.("lifecycle.tool.effect_failed", {
    phase,
    tool: toolId,
    tool_call_id: toolCallId,
    message: errorMessage(error),
  });
}

function assertStepBudget(input: Pick<ToolRunInput<unknown>, "session" | "options">): void {
  if (input.options?.skipStepBudget) return;
  const budgetError = checkStepBudget(input.session);
  if (!budgetError) return;
  const error = new Error(budgetError) as Error & { code: string; kind: string };
  error.code = LIFECYCLE_ERROR_CODES.budgetExhausted;
  error.kind = ERROR_KINDS.budgetExhausted;
  throw error;
}

async function runBeforeToolEffects(
  input: Pick<ToolRunInput<unknown>, "session" | "toolId" | "toolCallId" | "args">,
): Promise<void> {
  if (!input.session.onBeforeToolAsync) return;
  const ctx: PreToolContext = { toolId: input.toolId, toolCallId: input.toolCallId, args: input.args };
  try {
    await input.session.onBeforeToolAsync(ctx);
  } catch (error) {
    debugEffectFailure(input.session, "before", input.toolId, input.toolCallId, error);
  }
}

async function runAfterToolEffects(session: SessionContext, ctx: PostToolContext): Promise<EffectOutput | undefined> {
  if (!session.onAfterToolAsync) return undefined;
  try {
    return await session.onAfterToolAsync(ctx);
  } catch (error) {
    debugEffectFailure(session, "after", ctx.toolId, ctx.toolCallId, error);
    return undefined;
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

function recordToolSuccess<T>(session: SessionContext, toolId: string, args: Record<string, unknown>, result: T): void {
  recordCall(session, toolId, args, hashResultValue(result), "succeeded", {
    exitCode: extractExitCode(result),
    command: extractCommand(result),
  });
}

function recordToolFailure(session: SessionContext, toolId: string, args: Record<string, unknown>): void {
  recordCall(session, toolId, args, undefined, "failed", { command: commandFromArgs(args) });
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
    await runAfterToolEffects(input.session, {
      toolId: input.toolId,
      toolCallId: input.toolCallId,
      args: input.args,
      status: "failed",
      error: parsed.ok ? parsed.value : { message: `${input.toolId} failed` },
    });
    recordToolFailure(input.session, input.toolId, input.args);
    return;
  }

  recordToolSuccess(input.session, input.toolId, input.args, execution.result);
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
    // The filesystem raises a missing path itself, so the errno is the only place it is ever named.
    const code = field(error, "code");
    if (code === "ENOENT") {
      wrapped.code = LIFECYCLE_ERROR_CODES.fileNotFound;
      wrapped.kind = ERROR_KINDS.fileNotFound;
      throw wrapped;
    }
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
    await runBeforeToolEffects(input);
    const timeoutMs = resolveTimeoutMs(session, options);
    let execution = await executeToolTask(input, timeoutMs);
    try {
      if (execution.taskFailed) throw execution.taskError;
      // Effects finish before the result is assembled: what they appended is part of what the
      // model reads, and the next write cannot begin until they are done.
      const postOutput = await runAfterToolEffects(session, {
        toolId,
        toolCallId,
        args: args,
        status: "succeeded",
        result: execution.result,
      });
      return { result: execution.result, effectOutput: postOutput?.append || undefined };
    } catch (error) {
      execution = { result: undefined as T, taskFailed: true, taskError: error };
      throw error;
    } finally {
      await finalizeExecutedTool(input, execution);
    }
  });
}
