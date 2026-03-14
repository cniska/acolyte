import { invariant } from "./assert";
import { createId } from "./short-id";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES, ToolError } from "./error-primitives";
import { recordCall, runGuards, type SessionContext } from "./tool-guards";

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
export function streamCallId(toolName: string): string {
  return `${toolName}_${createId()}`;
}

export function runTool(
  session: SessionContext,
  toolId: string,
  args: object,
  execute: (toolCallId: string) => Promise<unknown>,
  options?: { timeoutMs?: number },
): Promise<unknown> {
  return withToolError(toolId, () =>
    guardedExecute(toolId, args, session, () => execute(streamCallId(toolId)), options),
  );
}

export async function withToolError<T>(toolId: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const wrapped = new Error(
      `${toolId} failed: ${error instanceof Error ? error.message : String(error)}`,
    ) as Error & {
      code?: string;
      kind?: string;
      recovery?: unknown;
    };
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) wrapped.code = code;
    }
    if (typeof error === "object" && error !== null && "kind" in error) {
      const kind = (error as { kind?: unknown }).kind;
      if (typeof kind === "string" && kind.length > 0) wrapped.kind = kind;
    }
    if (typeof error === "object" && error !== null && "recovery" in error) {
      wrapped.recovery = (error as { recovery?: unknown }).recovery;
    }
    throw wrapped;
  }
}

export async function guardedExecute<T>(
  toolId: string,
  args: object,
  session: SessionContext,
  task: () => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  try {
    runGuards({ toolName: toolId, args: args as Record<string, unknown>, session });
  } catch (error) {
    session.flags.consecutiveBlocks = (session.flags.consecutiveBlocks ?? 0) + 1;
    const wrapped = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Guard blocked");
    const coded = wrapped as Error & { code?: string; kind?: string };
    if (typeof coded.code !== "string" || coded.code.length === 0) coded.code = LIFECYCLE_ERROR_CODES.guardBlocked;
    if (typeof coded.kind !== "string" || coded.kind.length === 0) coded.kind = ERROR_KINDS.guardBlocked;
    throw coded;
  }
  const argsRecord = args as Record<string, unknown>;
  const cache = session.cache;
  const timeoutMs = options?.timeoutMs ?? session.toolTimeoutMs;
  invariant(
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0,
    "timeoutMs must be a positive number",
  );

  // Cache hit returns early with its own recordCall — the finally block only
  // runs on cache miss, so recordCall is never invoked twice for the same call.
  if (cache?.isCacheable(toolId)) {
    const cached = cache.get(toolId, argsRecord);
    if (cached) {
      session.onDebug?.("lifecycle.tool.cache", { tool: toolId, hit: true, ...cache.stats() });
      recordCall(session, toolId, argsRecord, hashResultValue(cached.result), true);
      return cached.result as T;
    }
    session.onDebug?.("lifecycle.tool.cache", { tool: toolId, hit: false, ...cache.stats() });
  }

  let taskFailed = false;
  let taskResult: unknown;
  try {
    taskResult = await withTimeout(task, timeoutMs, toolId);
    if (cache?.isCacheable(toolId)) {
      cache.set(toolId, argsRecord, { result: taskResult });
      cache.populateSubEntries(toolId, argsRecord, taskResult);
    }
    return taskResult as T;
  } catch (error) {
    taskFailed = true;
    throw error;
  } finally {
    recordCall(session, toolId, argsRecord, taskFailed ? undefined : hashResultValue(taskResult), !taskFailed);
    if (cache && !cache.isCacheable(toolId) && !taskFailed) {
      cache.invalidateForWrite(toolId, argsRecord);
    }
  }
}
