import { MAX_TOOL_CALLS_PER_REQUEST, TOOL_TIMEOUT_MS } from "./lifecycle-constants";
import type { SessionContext, ToolCallRecord, ToolCallStatus } from "./tool-contract";

export function createSessionContext(taskId?: string, writeTools: ReadonlySet<string> = new Set()): SessionContext {
  return {
    callLog: [],
    taskId,
    writeTools,
    toolTimeoutMs: TOOL_TIMEOUT_MS,
  };
}

export function scopedCallLog(session: Pick<SessionContext, "callLog" | "taskId">, taskId?: string): ToolCallRecord[] {
  const id = taskId ?? session.taskId;
  if (!id) return [...session.callLog];
  return session.callLog.filter((entry) => entry.taskId === id);
}

export function checkStepBudget(session: SessionContext): string | undefined {
  const limit = session.maxToolCallsPerRequest ?? MAX_TOOL_CALLS_PER_REQUEST;
  if (session.callLog.length >= limit) {
    return `Request tool-call limit reached (${limit}).`;
  }
  return undefined;
}

export function recordCall(
  session: SessionContext,
  toolName: string,
  args: Record<string, unknown>,
  resultHash?: string,
  status: ToolCallStatus = "succeeded",
  meta?: { exitCode?: number },
): void {
  session.callLog.push({ toolName, args, taskId: session.taskId, resultHash, status, ...meta });
}
