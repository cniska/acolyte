import type { LanguageModelV4Message } from "@ai-sdk/provider";

export const BUDGET_NOTICE_TAG = "budget";

export function wrapInSystemReminder(tag: string, text: string): string {
  return `<system-reminder type="${tag}">\n${text}\n</system-reminder>`;
}

export function budgetNoticeText(count: number, limit: number): string {
  return `Tool calls this turn: ${count}/${limit}. Tool execution stops when the limit is reached.`;
}

export function renderBudgetNotice(count: number, limit: number): LanguageModelV4Message {
  return {
    role: "user",
    content: [{ type: "text", text: wrapInSystemReminder(BUDGET_NOTICE_TAG, budgetNoticeText(count, limit)) }],
  };
}
