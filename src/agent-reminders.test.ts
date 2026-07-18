import { describe, expect, test } from "bun:test";
import type { LanguageModelV4Message } from "@ai-sdk/provider";
import {
  budgetPressureTag,
  collectReminders,
  detectBudgetPressure,
  detectPostFailure,
  postFailureTag,
  type RemindersConfig,
  turnsSinceLastReminder,
} from "./agent-reminders";
import { renderReminder, wrapInSystemReminder } from "./agent-reminders-render";
import type { ToolCallRecord, ToolCallStatus } from "./tool-contract";

const RUNNER_TOOL_SET = new Set(["test-run"]);

function edit(path: string, status: ToolCallStatus = "succeeded"): ToolCallRecord {
  return { toolName: "file-edit", args: { path }, status };
}

function call(
  toolName: string,
  args: Record<string, unknown>,
  status: ToolCallStatus = "succeeded",
  meta?: Pick<ToolCallRecord, "exitCode">,
): ToolCallRecord {
  return { toolName, args, status, ...meta };
}

function userReminderMessage(tag: string): LanguageModelV4Message {
  return {
    role: "user",
    content: [{ type: "text", text: `<system-reminder type="${tag}">\nprior\n</system-reminder>` }],
  };
}

const EMPTY_MESSAGES: LanguageModelV4Message[] = [];

function input(overrides: {
  messages?: readonly LanguageModelV4Message[];
  callLog?: readonly ToolCallRecord[];
  runnerToolSet?: ReadonlySet<string>;
  budget?: { used: number; limit: number };
  config?: RemindersConfig;
}) {
  return {
    messages: overrides.messages ?? EMPTY_MESSAGES,
    callLog: overrides.callLog ?? [],
    runnerToolSet: overrides.runnerToolSet ?? RUNNER_TOOL_SET,
    ...(overrides.budget ? { budget: overrides.budget } : {}),
    config: overrides.config,
  };
}

describe("wrapInSystemReminder", () => {
  test("wraps text with typed tags", () => {
    expect(wrapInSystemReminder("budget-pressure-50", "hi")).toBe(
      '<system-reminder type="budget-pressure-50">\nhi\n</system-reminder>',
    );
  });
});

describe("renderReminder", () => {
  test("renders budget-pressure soft variant with threshold-encoded tag", () => {
    const msg = renderReminder({
      type: "budget-pressure",
      thresholdPct: 0.5,
      variant: "soft",
      used: 5,
      limit: 10,
    });
    expect(msg).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text:
            '<system-reminder type="budget-pressure-50">\n' +
            "Budget: 5/10 tool calls used (50%)." +
            " List remaining scope items ranked by cost and identify the minimum viable slice you can ship cleanly.\n" +
            "</system-reminder>",
        },
      ],
    });
  });

  test("renders budget-pressure urgent variant with stronger phrasing", () => {
    const msg = renderReminder({
      type: "budget-pressure",
      thresholdPct: 0.75,
      variant: "urgent",
      used: 8,
      limit: 10,
    });
    expect(msg).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text:
            '<system-reminder type="budget-pressure-75">\n' +
            "Budget: 8/10 tool calls used (75%)." +
            " Descope now — pick the single highest-value slice and commit or hand off the rest." +
            " Budget exhaustion produces worse handoffs than voluntary descope.\n" +
            "</system-reminder>",
        },
      ],
    });
  });
});

describe("detectBudgetPressure", () => {
  test("does not fire without a budget", () => {
    expect(detectBudgetPressure(input({}))).toEqual([]);
  });

  test("does not fire below the first threshold", () => {
    expect(detectBudgetPressure(input({ budget: { used: 4, limit: 10 } }))).toEqual([]);
  });

  test("fires at the 50% threshold with soft variant", () => {
    const out = detectBudgetPressure(input({ budget: { used: 5, limit: 10 } }));
    expect(out).toEqual([{ type: "budget-pressure", thresholdPct: 0.5, variant: "soft", used: 5, limit: 10 }]);
  });

  test("fires at the 75% threshold with urgent variant", () => {
    const out = detectBudgetPressure(input({ budget: { used: 8, limit: 10 } }));
    expect(out).toEqual([{ type: "budget-pressure", thresholdPct: 0.75, variant: "urgent", used: 8, limit: 10 }]);
  });

  test("picks highest crossed threshold when multiple cross with nothing announced", () => {
    const out = detectBudgetPressure(input({ budget: { used: 8, limit: 10 } }));
    expect(out).toHaveLength(1);
    expect(out[0].thresholdPct).toBe(0.75);
  });

  test("skips already-announced thresholds", () => {
    const messages: LanguageModelV4Message[] = [userReminderMessage(budgetPressureTag(0.5))];
    expect(detectBudgetPressure(input({ messages, budget: { used: 5, limit: 10 } }))).toEqual([]);
  });

  test("fires 75% after 50% was already announced", () => {
    const messages: LanguageModelV4Message[] = [userReminderMessage(budgetPressureTag(0.5))];
    const out = detectBudgetPressure(input({ messages, budget: { used: 8, limit: 10 } }));
    expect(out).toEqual([{ type: "budget-pressure", thresholdPct: 0.75, variant: "urgent", used: 8, limit: 10 }]);
  });

  test("does not fire when budget is already exhausted", () => {
    expect(detectBudgetPressure(input({ budget: { used: 10, limit: 10 } }))).toEqual([]);
  });

  test("does not fire for non-positive limits", () => {
    expect(detectBudgetPressure(input({ budget: { used: 0, limit: 0 } }))).toEqual([]);
  });

  test("config overrides default thresholds", () => {
    const out = detectBudgetPressure(
      input({ budget: { used: 3, limit: 10 }, config: { budgetNudgeThresholds: [0.25] } }),
    );
    expect(out).toEqual([{ type: "budget-pressure", thresholdPct: 0.25, variant: "urgent", used: 3, limit: 10 }]);
  });

  test("marks only the highest configured threshold as urgent", () => {
    const out = detectBudgetPressure(
      input({ budget: { used: 3, limit: 10 }, config: { budgetNudgeThresholds: [0.25, 0.5, 0.9] } }),
    );
    expect(out).toEqual([{ type: "budget-pressure", thresholdPct: 0.25, variant: "soft", used: 3, limit: 10 }]);
  });
});

describe("collectReminders", () => {
  test("returns empty when nothing fires", () => {
    expect(collectReminders(input({}))).toEqual([]);
  });

  test("aggregates fired reminders", () => {
    const callLog: ToolCallRecord[] = [call("test-run", { command: "bun test" }, "failed", { exitCode: 1 })];
    const out = collectReminders(input({ callLog, budget: { used: 8, limit: 10 } }));
    expect(out.map((r) => r.type)).toEqual(["budget-pressure", "post-failure"]);
  });
});

describe("turnsSinceLastReminder", () => {
  test("returns Infinity when no matching reminder exists", () => {
    expect(turnsSinceLastReminder([], "budget-pressure-80")).toBe(Number.POSITIVE_INFINITY);
  });

  test("counts assistant turns since a matching reminder", () => {
    const messages: LanguageModelV4Message[] = [
      userReminderMessage("budget-pressure-80"),
      { role: "assistant", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
    ];
    expect(turnsSinceLastReminder(messages, "budget-pressure-80")).toBe(2);
  });

  test("ignores reminders of a different type", () => {
    const messages: LanguageModelV4Message[] = [
      userReminderMessage("budget-pressure-80"),
      { role: "assistant", content: [{ type: "text", text: "a" }] },
    ];
    expect(turnsSinceLastReminder(messages, "budget-pressure-90")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("detectPostFailure", () => {
  test("fires when the most recent runner failed", () => {
    const reminders = detectPostFailure(
      input({ callLog: [call("test-run", { command: "bun test" }, "failed", { exitCode: 1 })] }),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      type: "post-failure",
      toolName: "test-run",
      exitCode: 1,
      command: "bun test",
    });
  });

  test("does not fire when the most recent runner succeeded", () => {
    const reminders = detectPostFailure(
      input({ callLog: [call("test-run", { command: "bun test" }, "succeeded", { exitCode: 0 })] }),
    );
    expect(reminders).toHaveLength(0);
  });

  test("does not fire when no runners in call log", () => {
    const reminders = detectPostFailure(input({ callLog: [edit("src/app.ts")] }));
    expect(reminders).toHaveLength(0);
  });

  test("does not re-fire for the same fingerprint", () => {
    const tag = postFailureTag("test-run", "bun test");
    const reminders = detectPostFailure(
      input({
        messages: [userReminderMessage(tag)],
        callLog: [call("test-run", { command: "bun test" }, "failed", { exitCode: 1 })],
      }),
    );
    expect(reminders).toHaveLength(0);
  });

  test("fires again for a different command fingerprint", () => {
    const tag = postFailureTag("test-run", "bun test src/foo.test.ts");
    const reminders = detectPostFailure(
      input({
        messages: [userReminderMessage(tag)],
        callLog: [call("test-run", { command: "bun test src/bar.test.ts" }, "failed", { exitCode: 1 })],
      }),
    );
    expect(reminders).toHaveLength(1);
  });

  test("fires after a failed runner that has no command arg", () => {
    const reminders = detectPostFailure(
      input({
        callLog: [call("shell-run", {}, "failed", { exitCode: 2 })],
        runnerToolSet: new Set(["test-run", "shell-run"]),
      }),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      type: "post-failure",
      toolName: "shell-run",
      exitCode: 2,
      command: undefined,
    });
  });

  test("uses exitCode 1 as default when exitCode is absent", () => {
    const reminders = detectPostFailure(input({ callLog: [call("test-run", { command: "bun test" }, "failed")] }));
    expect(reminders[0]?.exitCode).toBe(1);
  });
});

describe("renderReminder — post-failure", () => {
  test("includes tool name, command, and exit code", () => {
    const msg = renderReminder({ type: "post-failure", toolName: "test-run", command: "bun test", exitCode: 1 });
    const text = (msg.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("test-run");
    expect(text).toContain("bun test");
    expect(text).toContain("exit code 1");
    expect(text).toContain("state the failure mode");
  });

  test("omits command when absent", () => {
    const msg = renderReminder({ type: "post-failure", toolName: "shell-run", command: undefined, exitCode: 2 });
    const text = (msg.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("shell-run");
    expect(text).not.toContain("undefined");
  });
});
