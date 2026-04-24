import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { STUCK_LOOP_SAME_FILE_THRESHOLD, STUCK_LOOP_TURNS_BETWEEN_REMINDERS } from "./lifecycle-constants";
import type { ToolCallRecord } from "./tool-session";

export type StuckLoopReminder = { type: "stuck-loop"; path: string; editCount: number };

export type Reminder = StuckLoopReminder;

export type CollectInput = {
  messages: readonly LanguageModelV3Message[];
  callLog: readonly ToolCallRecord[];
  writeToolSet: ReadonlySet<string>;
  config?: RemindersConfig;
};

export type RemindersConfig = {
  stuckLoopSameFileThreshold?: number;
  stuckLoopTurnsBetweenReminders?: number;
};

export function collectReminders(input: CollectInput): Reminder[] {
  return [...detectStuckLoop(input)];
}

const TEST_RUNNER_TOOL_IDS = new Set(["test-run"]);

export function detectStuckLoop(input: CollectInput): StuckLoopReminder[] {
  const threshold = input.config?.stuckLoopSameFileThreshold ?? STUCK_LOOP_SAME_FILE_THRESHOLD;
  const turnsBetween = input.config?.stuckLoopTurnsBetweenReminders ?? STUCK_LOOP_TURNS_BETWEEN_REMINDERS;

  const lastPath = findLastWritePath(input.callLog, input.writeToolSet);
  if (!lastPath) return [];

  const editCount = countConsecutiveEditsSinceGreenTest(input.callLog, input.writeToolSet, lastPath);
  if (editCount < threshold) return [];

  if (turnsSinceLastReminder(input.messages, "stuck-loop") < turnsBetween) return [];

  return [{ type: "stuck-loop", path: lastPath, editCount }];
}

function findLastWritePath(callLog: readonly ToolCallRecord[], writeToolSet: ReadonlySet<string>): string | undefined {
  for (let i = callLog.length - 1; i >= 0; i--) {
    const entry = callLog[i];
    if (!writeToolSet.has(entry.toolName)) continue;
    const path = entry.args.path;
    if (typeof path === "string" && path.length > 0) return path;
  }
  return undefined;
}

function countConsecutiveEditsSinceGreenTest(
  callLog: readonly ToolCallRecord[],
  writeToolSet: ReadonlySet<string>,
  path: string,
): number {
  let count = 0;
  for (let i = callLog.length - 1; i >= 0; i--) {
    const entry = callLog[i];
    if (TEST_RUNNER_TOOL_IDS.has(entry.toolName) && entry.status === "succeeded") break;
    if (!writeToolSet.has(entry.toolName)) continue;
    if (entry.args.path === path) count += 1;
  }
  return count;
}

export function turnsSinceLastReminder(messages: readonly LanguageModelV3Message[], type: Reminder["type"]): number {
  const tag = `<system-reminder type="${type}">`;
  let turns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") turns += 1;
    if (msg.role !== "user") continue;
    for (const part of msg.content) {
      if (part.type === "text" && part.text.includes(tag)) return turns;
    }
  }
  return Number.POSITIVE_INFINITY;
}
