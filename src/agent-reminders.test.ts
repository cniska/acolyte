import { describe, expect, test } from "bun:test";
import { BUDGET_NOTICE_TAG, budgetNoticeText, renderBudgetNotice, wrapInSystemReminder } from "./agent-reminders";

describe("wrapInSystemReminder", () => {
  test("wraps text with a typed tag", () => {
    expect(wrapInSystemReminder(BUDGET_NOTICE_TAG, "hi")).toBe(
      '<system-reminder type="budget">\nhi\n</system-reminder>',
    );
  });
});

describe("budgetNoticeText", () => {
  test("states the count, limit, and factual consequence", () => {
    expect(budgetNoticeText(450, 500)).toBe(
      "Tool calls this turn: 450/500. Tool execution stops when the limit is reached.",
    );
  });

  // Regression (dogfood, gpt-5-mini): the old budget reminder leaked imperative coaching into
  // user-facing answers. The notice must carry data plus consequence only, no directives.
  test("contains no imperative coaching aimed at the model", () => {
    const text = budgetNoticeText(450, 500).toLowerCase();
    for (const verb of [
      "descope",
      "commit",
      "wrap up",
      "rank",
      "minimum viable",
      "hand off",
      "you should",
      "pick the",
    ]) {
      expect(text).not.toContain(verb);
    }
  });
});

describe("renderBudgetNotice", () => {
  test("renders a user-role system-reminder message", () => {
    expect(renderBudgetNotice(460, 500)).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text:
            '<system-reminder type="budget">\n' +
            "Tool calls this turn: 460/500. Tool execution stops when the limit is reached.\n" +
            "</system-reminder>",
        },
      ],
    });
  });
});
