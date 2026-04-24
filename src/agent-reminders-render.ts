import type { LanguageModelV3Message } from "@ai-sdk/provider";
import type { Reminder } from "./agent-reminders";

export function wrapInSystemReminder(type: Reminder["type"], text: string): string {
  return `<system-reminder type="${type}">\n${text}\n</system-reminder>`;
}

export function renderReminder(reminder: Reminder): LanguageModelV3Message {
  return {
    role: "user",
    content: [{ type: "text", text: wrapInSystemReminder(reminder.type, reminderText(reminder)) }],
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
  }
}
