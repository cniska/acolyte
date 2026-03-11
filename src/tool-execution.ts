import { createId } from "./short-id";
import { isCacheableTool } from "./tool-cache";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { recordCall, runGuards, type SessionContext } from "./tool-guards";
export function streamCallId(toolName: string): string {
  return `${toolName}_${createId()}`;
}

export function runTool(
  session: SessionContext,
  toolId: string,
  args: object,
  execute: (toolCallId: string) => Promise<unknown>,
): Promise<unknown> {
  return withToolError(toolId, () => guardedExecute(toolId, args, session, () => execute(streamCallId(toolId))));
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

export async function guardedExecute<T>(
  toolId: string,
  args: object,
  session: SessionContext,
  task: () => Promise<T>,
): Promise<T> {
  try {
    runGuards({ toolName: toolId, args: args as Record<string, unknown>, session });
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Guard blocked");
    const coded = wrapped as Error & { code?: string; kind?: string };
    if (typeof coded.code !== "string" || coded.code.length === 0) coded.code = LIFECYCLE_ERROR_CODES.guardBlocked;
    if (typeof coded.kind !== "string" || coded.kind.length === 0) coded.kind = ERROR_KINDS.guardBlocked;
    throw coded;
  }
  const argsRecord = args as Record<string, unknown>;
  const cache = session.cache;

  if (cache && isCacheableTool(toolId)) {
    const cached = cache.get(toolId, argsRecord);
    if (cached) {
      recordCall(session, toolId, argsRecord);
      return cached.result as T;
    }
  }

  try {
    const result = await task();
    if (cache && isCacheableTool(toolId)) {
      cache.set(toolId, argsRecord, { result });
    }
    return result;
  } finally {
    recordCall(session, toolId, argsRecord);
    if (cache && !isCacheableTool(toolId)) {
      cache.invalidateForWrite(toolId, argsRecord);
    }
  }
}
