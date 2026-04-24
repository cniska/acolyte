import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { type Reminder, reminderTag } from "./agent-reminders";

export function wrapInSystemReminder(tag: string, text: string): string {
  return `<system-reminder type="${tag}">\n${text}\n</system-reminder>`;
}

export function renderReminder(reminder: Reminder): LanguageModelV3Message {
  return {
    role: "user",
    content: [{ type: "text", text: wrapInSystemReminder(reminderTag(reminder), reminderText(reminder)) }],
  };
}

function reminderText(reminder: Reminder): string {
  switch (reminder.type) {
    case "stuck-loop":
      return [
        `You have edited \`${reminder.path}\` ${reminder.editCount} times without a passing test. Stop editing.`,
        "Re-read the file from scratch and state the failure mode in one sentence before the next edit.",
        "Consider whether the test design itself is the problem.",
      ].join(" ");
    case "budget-pressure":
      return budgetPressureText(reminder.thresholdPct, reminder.used, reminder.limit);
  }
}

function budgetPressureText(thresholdPct: number, used: number, limit: number): string {
  const pct = Math.round(thresholdPct * 100);
  if (thresholdPct < 0.75) {
    return [
      `Budget: ${used}/${limit} tool calls used (${pct}%).`,
      "List remaining scope items ranked by cost and identify the minimum viable slice you can ship cleanly.",
    ].join(" ");
  }
  return [
    `Budget: ${used}/${limit} tool calls used (${pct}%).`,
    "Descope now — pick the single highest-value slice and commit or hand off the rest.",
    "Budget exhaustion produces worse handoffs than voluntary descope.",
  ].join(" ");
}
