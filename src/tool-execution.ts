import { invariant } from "./assert";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES } from "./error-contract";
import { ToolError } from "./tool-error";
import { checkStepBudget, recordCall, type SessionContext } from "./tool-session";

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

export async function withToolError<T>(toolId: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`${toolId} failed: ${baseMessage}`) as Error & {
      code?: string;
      kind?: string;
    };
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) wrapped.code = code;
    }
    if (typeof error === "object" && error !== null && "kind" in error) {
      const kind = (error as { kind?: unknown }).kind;
      if (typeof kind === "string" && kind.length > 0) wrapped.kind = kind;
    }
    throw wrapped;
  }
}

export type RunToolResult<T = unknown> = { result: T; effectOutput?: string };

export async function runTool(
  session: SessionContext,
  toolId: string,
  toolCallId: string,
  args: Record<string, unknown>,
  execute: (toolCallId: string) => Promise<unknown>,
  options?: { timeoutMs?: number },
): Promise<RunToolResult> {
  return withToolError(toolId, async () => {
    const budgetError = checkStepBudget(session);
    if (budgetError) {
      const error = new Error(budgetError) as Error & { code: string; kind: string };
      error.code = LIFECYCLE_ERROR_CODES.budgetExhausted;
      error.kind = ERROR_KINDS.budgetExhausted;
      throw error;
    }

    const preOutput = session.onBeforeTool?.({ toolId, toolCallId, args });
    if (session.onBeforeToolAsync) {
      try {
        await session.onBeforeToolAsync({ toolId, toolCallId, args });
      } catch (error) {
        session.onDebug?.("lifecycle.tool.hook_failed", {
          hook: "before",
          tool: toolId,
          tool_call_id: toolCallId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const cache = session.cache;
    const timeoutMs = options?.timeoutMs ?? session.toolTimeoutMs;
    invariant(
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0,
      "timeoutMs must be a positive number",
    );

    if (cache?.isCacheable(toolId)) {
      const cached = cache.get(toolId, args);
      if (cached) {
        session.onDebug?.("lifecycle.tool.cache", { tool: toolId, hit: true, ...cache.stats() });
        if (session.onAfterToolAsync) {
          try {
            await session.onAfterToolAsync({
              toolId,
              toolCallId,
              args: args,
              status: "succeeded",
              result: cached.result,
            });
          } catch (error) {
            session.onDebug?.("lifecycle.tool.hook_failed", {
              hook: "after",
              tool: toolId,
              tool_call_id: toolCallId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        recordCall(session, toolId, args, hashResultValue(cached.result), "succeeded");
        return { result: cached.result };
      }
      session.onDebug?.("lifecycle.tool.cache", { tool: toolId, hit: false, ...cache.stats() });
    }

    let taskFailed = false;
    let taskResult: unknown;
    let taskError: unknown;
    try {
      taskResult = await withTimeout(() => execute(toolCallId), timeoutMs, toolId);
      if (cache?.isCacheable(toolId)) {
        cache.set(toolId, args, { result: taskResult });
        cache.populateSubEntries(toolId, args, taskResult);
      }
      const postOutput = session.onAfterTool?.({
        toolId,
        toolCallId,
        args: args,
        status: "succeeded",
        result: taskResult,
      });
      const append = [preOutput?.append, postOutput?.append].filter(Boolean).join("\n");
      return { result: taskResult, effectOutput: append || undefined };
    } catch (error) {
      taskFailed = true;
      taskError = error;
      throw error;
    } finally {
      if (session.onAfterToolAsync) {
        try {
          await session.onAfterToolAsync({
            toolId,
            toolCallId,
            args: args,
            status: taskFailed ? "failed" : "succeeded",
            result: taskFailed ? undefined : taskResult,
            error: taskFailed ? taskError : undefined,
          });
        } catch (error) {
          session.onDebug?.("lifecycle.tool.hook_failed", {
            hook: "after",
            tool: toolId,
            tool_call_id: toolCallId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordCall(
        session,
        toolId,
        args,
        taskFailed ? undefined : hashResultValue(taskResult),
        taskFailed ? "failed" : "succeeded",
      );
      if (cache && !cache.isCacheable(toolId) && !taskFailed) {
        cache.invalidateForWrite(toolId, args);
      }
    }
  });
}
