import { CONSECUTIVE_GUARD_BLOCK_LIMIT, TOOL_TIMEOUT_MS } from "./lifecycle-constants";
import type { ToolCache } from "./tool-contract";
import type { WorkspaceProfile } from "./workspace-profile";

const DEFAULT_CYCLE_STEP_LIMIT = 80;
const DEFAULT_TOTAL_STEP_LIMIT = 200;

export type GuardEvent = {
  guardId: string;
  toolName: string;
  action: "blocked" | "flag_set";
  detail?: string;
};

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
  guardStats?: { blocked: number; flagSet: number };
  consecutiveBlocks?: number;
  consecutiveGuardBlockLimit?: number;
};

export type SessionContext = {
  callLog: ToolCallRecord[];
  taskId?: string;
  flags: SessionFlags;
  writeTools: ReadonlySet<string>;
  toolTimeoutMs?: number;
  onGuard?: (event: GuardEvent) => void;
  cache?: ToolCache;
  onDebug?: (event: `lifecycle.${string}`, data: Record<string, unknown>) => void;
  workspaceProfile?: WorkspaceProfile;
};

type GuardSession = {
  readonly callLog: readonly ToolCallRecord[];
  readonly taskId?: string;
  readonly flags: Readonly<SessionFlags>;
  readonly writeTools: ReadonlySet<string>;
};

export type GuardInput = {
  toolName: string;
  args: Record<string, unknown>;
  session: GuardSession;
};

export type GuardPatch = {
  cycleStepCount?: number;
};

export type GuardResult = { type: "allow"; patch?: GuardPatch } | { type: "block"; detail?: string; message: string };

function allowGuard(patch?: GuardPatch): GuardResult {
  return patch ? { type: "allow", patch } : { type: "allow" };
}

function blockGuard(message: string, detail?: string): GuardResult {
  return detail ? { type: "block", message, detail } : { type: "block", message };
}

export type ToolGuard = {
  id: string;
  description: string;
  tools?: readonly string[];
  check: (input: GuardInput) => GuardResult;
};

export function createSessionContext(taskId?: string, writeTools: ReadonlySet<string> = new Set()): SessionContext {
  return {
    callLog: [],
    taskId,
    flags: { consecutiveGuardBlockLimit: CONSECUTIVE_GUARD_BLOCK_LIMIT },
    writeTools,
    toolTimeoutMs: TOOL_TIMEOUT_MS,
  };
}

export function scopedCallLog(session: Pick<GuardSession, "callLog" | "taskId">, taskId?: string): ToolCallRecord[] {
  const id = taskId ?? session.taskId;
  if (!id) return [...session.callLog];
  return session.callLog.filter((entry) => entry.taskId === id);
}

export function resetCycleStepCount(session: SessionContext, limit?: number): void {
  session.flags.cycleStepCount = 0;
  if (limit !== undefined) session.flags.cycleStepLimit = limit;
}

const stepBudgetGuard: ToolGuard = {
  id: "step-budget",
  description: "Enforce per-cycle and total step limits.",
  check({ session }) {
    const cycleLimit = session.flags.cycleStepLimit ?? DEFAULT_CYCLE_STEP_LIMIT;
    const cycleCount = session.flags.cycleStepCount ?? 0;
    const totalLimit = session.flags.totalStepLimit ?? DEFAULT_TOTAL_STEP_LIMIT;
    const totalCount = session.callLog.length;

    if (totalCount >= totalLimit) {
      return blockGuard(`Total step budget exhausted (${totalLimit} tool calls). Commit what you have.`, "total-limit");
    }
    if (cycleCount >= cycleLimit) {
      return blockGuard(
        `Cycle step budget exhausted (${cycleLimit} tool calls). Wrap up current phase.`,
        "cycle-limit",
      );
    }
    return allowGuard({ cycleStepCount: cycleCount + 1 });
  },
};

const GUARDS: ToolGuard[] = [stepBudgetGuard];

function applyGuardPatch(session: SessionContext, patch: GuardPatch): void {
  if (patch.cycleStepCount !== undefined) session.flags.cycleStepCount = patch.cycleStepCount;
}

export function runGuards(input: { toolName: string; args: Record<string, unknown>; session: SessionContext }): void {
  const patches: GuardPatch[] = [];
  for (const guard of GUARDS) {
    if (guard.tools && !guard.tools.includes(input.toolName)) continue;
    const result = guard.check(input);
    if (result.type === "block") {
      input.session.onGuard?.({
        guardId: guard.id,
        toolName: input.toolName,
        action: "blocked",
        detail: result.detail,
      });
      throw new Error(result.message);
    }
    if (result.patch) patches.push(result.patch);
  }
  for (const patch of patches) applyGuardPatch(input.session, patch);
  input.session.flags.consecutiveBlocks = 0;
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
