import { createId } from "./short-id";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES } from "./tool-error-codes";
import { recordCall, runGuards, type SessionContext } from "./tool-guards";
export function streamCallId(toolName: string): string {
  return `${toolName}_${createId()}`;
}

export function runTool(
  session: SessionContext,
  toolId: string,
  args: Record<string, unknown>,
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
  args: Record<string, unknown>,
  session: SessionContext,
  task: () => Promise<T>,
): Promise<T> {
  try {
    runGuards({ toolName: toolId, args, session });
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Guard blocked");
    const coded = wrapped as Error & { code?: string; kind?: string };
    if (typeof coded.code !== "string" || coded.code.length === 0) coded.code = LIFECYCLE_ERROR_CODES.guardBlocked;
    if (typeof coded.kind !== "string" || coded.kind.length === 0) coded.kind = ERROR_KINDS.guardBlocked;
    throw coded;
  }
  try {
    const result = await task();
    return result;
  } finally {
    recordCall(session, toolId, args);
  }
}
