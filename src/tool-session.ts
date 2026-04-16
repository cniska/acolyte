import type { ResolvedFeatureFlags } from "./feature-flags-contract";
import { MAX_CONSECUTIVE_TOOL_FAILURES, MAX_TOTAL_STEPS, MAX_TURN_STEPS, TOOL_TIMEOUT_MS } from "./lifecycle-constants";
import type { ActiveSkill } from "./skill-contract";
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
  turnStepCount?: number;
  turnStepLimit?: number;
  totalStepLimit?: number;
  totalTokenLimit?: number;
  totalTokens?: () => number;
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
  consecutiveFailures: Map<string, number>;
  maxConsecutiveToolFailures?: number;
  onDebug?: (event: `lifecycle.${string}`, data: Record<string, unknown>) => void;
  onBeforeTool?: (ctx: PreToolContext) => EffectOutput | undefined;
  onAfterTool?: (ctx: PostToolContext) => EffectOutput | undefined;
  onBeforeToolAsync?: (ctx: PreToolContext) => Promise<void>;
  onAfterToolAsync?: (ctx: PostToolContext) => Promise<void>;
  workspaceProfile?: WorkspaceProfile;
  activeSkills?: ActiveSkill[];
};

export function createSessionContext(taskId?: string, writeTools: ReadonlySet<string> = new Set()): SessionContext {
  return {
    callLog: [],
    taskId,
    flags: {},
    writeTools,
    toolTimeoutMs: TOOL_TIMEOUT_MS,
    consecutiveFailures: new Map(),
  };
}

export function scopedCallLog(session: Pick<SessionContext, "callLog" | "taskId">, taskId?: string): ToolCallRecord[] {
  const id = taskId ?? session.taskId;
  if (!id) return [...session.callLog];
  return session.callLog.filter((entry) => entry.taskId === id);
}

export function resetTurnStepCount(session: SessionContext, limit?: number): void {
  session.flags.turnStepCount = 0;
  if (limit !== undefined) session.flags.turnStepLimit = limit;
}

export function checkStepBudget(session: SessionContext, toolId?: string): string | undefined {
  const tokenLimit = session.flags.totalTokenLimit;
  const getTokens = session.flags.totalTokens;
  if (tokenLimit && getTokens) {
    const tokens = getTokens();
    if (tokens >= tokenLimit) {
      return `Token budget exhausted (${tokens} tokens, limit ${tokenLimit}). Commit what you have.`;
    }
  }

  if (toolId) {
    const limit = session.maxConsecutiveToolFailures ?? MAX_CONSECUTIVE_TOOL_FAILURES;
    const failures = session.consecutiveFailures.get(toolId) ?? 0;
    if (failures >= limit) {
      return `Tool "${toolId}" failed ${failures} times consecutively. Skipping further attempts.`;
    }
  }

  const turnLimit = session.flags.turnStepLimit ?? MAX_TURN_STEPS;
  const turnCount = session.flags.turnStepCount ?? 0;
  const totalLimit = session.flags.totalStepLimit ?? MAX_TOTAL_STEPS;
  const totalCount = session.callLog.length;

  if (totalCount >= totalLimit) {
    return `Total step budget exhausted (${totalLimit} tool calls). Commit what you have.`;
  }
  if (turnCount >= turnLimit) {
    return `Turn step budget exhausted (${turnLimit} tool calls). Wrap up current phase.`;
  }
  session.flags.turnStepCount = turnCount + 1;
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
  if (status === "failed") {
    session.consecutiveFailures.set(toolName, (session.consecutiveFailures.get(toolName) ?? 0) + 1);
  } else {
    session.consecutiveFailures.delete(toolName);
  }
}
