import type { ResolvedFeatureFlags } from "./feature-flags-contract";
import { INITIAL_MAX_STEPS, TOOL_TIMEOUT_MS, TOTAL_MAX_STEPS } from "./lifecycle-constants";
import type { ActiveSkill } from "./session-contract";
import type { ToolCache } from "./tool-contract";
import type { WorkspaceProfile } from "./workspace-profile";

export type ToolCallStatus = "succeeded" | "failed";

export type ToolCallRecord = {
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  resultHash?: string;
  status: ToolCallStatus;
};

export type SessionFlags = {
  cycleStepCount?: number;
  cycleStepLimit?: number;
  totalStepLimit?: number;
};

export type ToolErrorSummary = { message: string; code?: string; kind?: string };

export type PreToolContext = { toolId: string; toolCallId: string; args: Record<string, unknown> };
export type PostToolContext =
  | {
      toolId: string;
      toolCallId: string;
      args: Record<string, unknown>;
      status: "succeeded";
      result: unknown;
    }
  | {
      toolId: string;
      toolCallId: string;
      args: Record<string, unknown>;
      status: "failed";
      error: ToolErrorSummary;
    };
export type EffectOutput = { append?: string };

export type SessionContext = {
  callLog: ToolCallRecord[];
  taskId?: string;
  flags: SessionFlags;
  writeTools: ReadonlySet<string>;
  toolTimeoutMs?: number;
  cache?: ToolCache;
  featureFlags?: ResolvedFeatureFlags;
  onDebug?: (event: `lifecycle.${string}`, data: Record<string, unknown>) => void;
  onBeforeTool?: (ctx: PreToolContext) => EffectOutput | undefined;
  onAfterTool?: (ctx: PostToolContext) => EffectOutput | undefined;
  onBeforeToolAsync?: (ctx: PreToolContext) => Promise<void>;
  onAfterToolAsync?: (ctx: PostToolContext) => Promise<void>;
  workspaceProfile?: WorkspaceProfile;
  activeSkill?: ActiveSkill;
};

export function createSessionContext(taskId?: string, writeTools: ReadonlySet<string> = new Set()): SessionContext {
  return {
    callLog: [],
    taskId,
    flags: {},
    writeTools,
    toolTimeoutMs: TOOL_TIMEOUT_MS,
  };
}

export function scopedCallLog(session: Pick<SessionContext, "callLog" | "taskId">, taskId?: string): ToolCallRecord[] {
  const id = taskId ?? session.taskId;
  if (!id) return [...session.callLog];
  return session.callLog.filter((entry) => entry.taskId === id);
}

export function resetCycleStepCount(session: SessionContext, limit?: number): void {
  session.flags.cycleStepCount = 0;
  if (limit !== undefined) session.flags.cycleStepLimit = limit;
}

export function checkStepBudget(session: SessionContext): string | undefined {
  const cycleLimit = session.flags.cycleStepLimit ?? INITIAL_MAX_STEPS;
  const cycleCount = session.flags.cycleStepCount ?? 0;
  const totalLimit = session.flags.totalStepLimit ?? TOTAL_MAX_STEPS;
  const totalCount = session.callLog.length;

  if (totalCount >= totalLimit) {
    return `Total step budget exhausted (${totalLimit} tool calls). Commit what you have.`;
  }
  if (cycleCount >= cycleLimit) {
    return `Cycle step budget exhausted (${cycleLimit} tool calls). Wrap up current phase.`;
  }
  session.flags.cycleStepCount = cycleCount + 1;
  return undefined;
}

export function recordCall(
  session: SessionContext,
  toolName: string,
  args: Record<string, unknown>,
  resultHash?: string,
  status: ToolCallStatus = "succeeded",
): void {
  session.callLog.push({ toolName, args, taskId: session.taskId, resultHash, status });
}
