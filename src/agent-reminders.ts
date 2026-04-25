import type { LanguageModelV3Message } from "@ai-sdk/provider";
import {
  BUDGET_NUDGE_THRESHOLDS,
  STUCK_LOOP_SAME_FILE_THRESHOLD,
  STUCK_LOOP_TURNS_BETWEEN_REMINDERS,
} from "./lifecycle-constants";
import type { ToolCallRecord } from "./tool-session";

export type StuckLoopReminder = { type: "stuck-loop"; path: string; editCount: number };
export type BudgetPressureReminder = {
  type: "budget-pressure";
  thresholdPct: number;
  variant: "soft" | "urgent";
  used: number;
  limit: number;
};

export type Reminder = StuckLoopReminder | BudgetPressureReminder;

export type CollectInput = {
  messages: readonly LanguageModelV3Message[];
  callLog: readonly ToolCallRecord[];
  writeToolSet: ReadonlySet<string>;
  runnerToolSet: ReadonlySet<string>;
  budget?: { used: number; limit: number };
  config?: RemindersConfig;
};

export type RemindersConfig = {
  stuckLoopSameFileThreshold?: number;
  stuckLoopTurnsBetweenReminders?: number;
  budgetNudgeThresholds?: readonly number[];
};

export function collectReminders(input: CollectInput): Reminder[] {
  return [...detectStuckLoop(input), ...detectBudgetPressure(input)];
}

export function detectStuckLoop(input: CollectInput): StuckLoopReminder[] {
  const threshold = input.config?.stuckLoopSameFileThreshold ?? STUCK_LOOP_SAME_FILE_THRESHOLD;
  const turnsBetween = input.config?.stuckLoopTurnsBetweenReminders ?? STUCK_LOOP_TURNS_BETWEEN_REMINDERS;

  const stuckLoop = findStuckLoop(input.callLog, input.writeToolSet, input.runnerToolSet);
  if (!stuckLoop || stuckLoop.editCount < threshold) return [];

  if (turnsSinceLastReminder(input.messages, "stuck-loop") < turnsBetween) return [];

  return [{ type: "stuck-loop", path: stuckLoop.path, editCount: stuckLoop.editCount }];
}

export function detectBudgetPressure(input: CollectInput): BudgetPressureReminder[] {
  const budget = input.budget;
  if (!budget || budget.limit <= 0) return [];
  if (budget.used >= budget.limit) return [];

  const thresholds = input.config?.budgetNudgeThresholds ?? BUDGET_NUDGE_THRESHOLDS;
  if (thresholds.length === 0) return [];

  const ratio = budget.used / budget.limit;
  const maxThreshold = Math.max(...thresholds);
  const crossed = thresholds.filter((t) => ratio >= t).sort((a, b) => b - a);
  for (const threshold of crossed) {
    if (turnsSinceLastReminder(input.messages, budgetPressureTag(threshold)) !== Number.POSITIVE_INFINITY) continue;
    return [
      {
        type: "budget-pressure",
        thresholdPct: threshold,
        variant: threshold >= maxThreshold ? "urgent" : "soft",
        used: budget.used,
        limit: budget.limit,
      },
    ];
  }
  return [];
}

export function budgetPressureTag(thresholdPct: number): string {
  return `budget-pressure-${Math.round(thresholdPct * 100)}`;
}

export function reminderTag(reminder: Reminder): string {
  switch (reminder.type) {
    case "stuck-loop":
      return reminder.type;
    case "budget-pressure":
      return budgetPressureTag(reminder.thresholdPct);
  }
}

export function turnsSinceLastReminder(messages: readonly LanguageModelV3Message[], tag: string): number {
  const marker = `<system-reminder type="${tag}">`;
  let turns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") turns += 1;
    if (msg.role !== "user") continue;
    for (const part of msg.content) {
      if (part.type === "text" && part.text.includes(marker)) return turns;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function findStuckLoop(
  callLog: readonly ToolCallRecord[],
  writeToolSet: ReadonlySet<string>,
  runnerToolSet: ReadonlySet<string>,
): { path: string; editCount: number } | undefined {
  let targetPath: string | undefined;
  let editCount = 0;
  for (let i = callLog.length - 1; i >= 0; i--) {
    const entry = callLog[i];
    if (isGreenRunner(entry, runnerToolSet)) break;
    if (!writeToolSet.has(entry.toolName)) continue;
    const path = entry.args.path;
    if (typeof path !== "string" || path.length === 0) continue;
    if (!targetPath) targetPath = path;
    if (path !== targetPath) break;
    editCount += 1;
  }
  return targetPath ? { path: targetPath, editCount } : undefined;
}

function isGreenRunner(entry: ToolCallRecord, runnerToolSet: ReadonlySet<string>): boolean {
  if (!runnerToolSet.has(entry.toolName)) return false;
  if (typeof entry.exitCode === "number") return entry.exitCode === 0;
  return entry.status === "succeeded";
}
