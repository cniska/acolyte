import type { LanguageModelV4Message } from "@ai-sdk/provider";
import { BUDGET_NUDGE_THRESHOLDS } from "./lifecycle-constants";
import type { ToolCallRecord } from "./tool-contract";

export type BudgetPressureReminder = {
  type: "budget-pressure";
  thresholdPct: number;
  variant: "soft" | "urgent";
  used: number;
  limit: number;
};

export type PostFailureReminder = {
  type: "post-failure";
  toolName: string;
  command: string | undefined;
  exitCode: number;
};

export type Reminder = BudgetPressureReminder | PostFailureReminder;

export type CollectInput = {
  messages: readonly LanguageModelV4Message[];
  callLog: readonly ToolCallRecord[];
  runnerToolSet: ReadonlySet<string>;
  budget?: { used: number; limit: number };
  config?: RemindersConfig;
};

export type RemindersConfig = {
  budgetNudgeThresholds?: readonly number[];
};

export function collectReminders(input: CollectInput): Reminder[] {
  return [...detectBudgetPressure(input), ...detectPostFailure(input)];
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

export function detectPostFailure(input: CollectInput): PostFailureReminder[] {
  for (let i = input.callLog.length - 1; i >= 0; i--) {
    const entry = input.callLog[i];
    if (!input.runnerToolSet.has(entry.toolName)) continue;
    if (isGreenRunner(entry, input.runnerToolSet)) return [];
    const exitCode = typeof entry.exitCode === "number" ? entry.exitCode : 1;
    const command = typeof entry.args.command === "string" ? entry.args.command : undefined;
    const tag = postFailureTag(entry.toolName, command);
    if (turnsSinceLastReminder(input.messages, tag) !== Number.POSITIVE_INFINITY) return [];
    return [{ type: "post-failure", toolName: entry.toolName, command, exitCode }];
  }
  return [];
}

export function postFailureTag(toolName: string, command: string | undefined): string {
  const suffix = command ? `:${command.slice(0, 60)}` : "";
  return `post-failure:${toolName}${suffix}`;
}

export function budgetPressureTag(thresholdPct: number): string {
  return `budget-pressure-${Math.round(thresholdPct * 100)}`;
}

export function reminderTag(reminder: Reminder): string {
  switch (reminder.type) {
    case "budget-pressure":
      return budgetPressureTag(reminder.thresholdPct);
    case "post-failure":
      return postFailureTag(reminder.toolName, reminder.command);
  }
}

export function turnsSinceLastReminder(messages: readonly LanguageModelV4Message[], tag: string): number {
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

function isGreenRunner(entry: ToolCallRecord, runnerToolSet: ReadonlySet<string>): boolean {
  if (!runnerToolSet.has(entry.toolName)) return false;
  if (typeof entry.exitCode === "number") return entry.exitCode === 0;
  return entry.status === "succeeded";
}
