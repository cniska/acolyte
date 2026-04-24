import { describe, expect, test } from "bun:test";
import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { collectReminders, detectStuckLoop, turnsSinceLastReminder } from "./agent-reminders";
import { renderReminder, wrapInSystemReminder } from "./agent-reminders-render";
import type { ToolCallRecord, ToolCallStatus } from "./tool-session";

const WRITE_TOOL_SET = new Set(["file-edit", "file-create"]);
const RUNNER_TOOL_SET = new Set(["test-run"]);

function edit(path: string, status: ToolCallStatus = "succeeded"): ToolCallRecord {
  return { toolName: "file-edit", args: { path }, status };
}

function call(toolName: string, args: Record<string, unknown>, status: ToolCallStatus = "succeeded"): ToolCallRecord {
  return { toolName, args, status };
}

function userReminderMessage(type: string): LanguageModelV3Message {
  return {
    role: "user",
    content: [{ type: "text", text: `<system-reminder type="${type}">\nprior\n</system-reminder>` }],
  };
}

const EMPTY_MESSAGES: LanguageModelV3Message[] = [];

function input(overrides: {
  messages?: readonly LanguageModelV3Message[];
  callLog?: readonly ToolCallRecord[];
  writeToolSet?: ReadonlySet<string>;
  runnerToolSet?: ReadonlySet<string>;
  config?: Parameters<typeof detectStuckLoop>[0]["config"];
}) {
  return {
    messages: overrides.messages ?? EMPTY_MESSAGES,
    callLog: overrides.callLog ?? [],
    writeToolSet: overrides.writeToolSet ?? WRITE_TOOL_SET,
    runnerToolSet: overrides.runnerToolSet ?? RUNNER_TOOL_SET,
    config: overrides.config,
  };
}

describe("wrapInSystemReminder", () => {
  test("wraps text with typed tags", () => {
    expect(wrapInSystemReminder("stuck-loop", "hi")).toBe(
      '<system-reminder type="stuck-loop">\nhi\n</system-reminder>',
    );
  });
});

describe("renderReminder", () => {
  test("renders stuck-loop as a user message with full wrapped content", () => {
    const msg = renderReminder({ type: "stuck-loop", path: "src/a.ts", editCount: 3 });
    expect(msg).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text:
            '<system-reminder type="stuck-loop">\n' +
            "You have edited `src/a.ts` 3 times without a passing test. Stop editing." +
            " Re-read the file from scratch and state the failure mode in one sentence before the next edit." +
            " Consider whether the test design itself is the problem.\n" +
            "</system-reminder>",
        },
      ],
    });
  });
});

describe("detectStuckLoop", () => {
  test("fires at the configured threshold", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/a.ts")];
    expect(detectStuckLoop(input({ callLog }))).toEqual([{ type: "stuck-loop", path: "src/a.ts", editCount: 3 }]);
  });

  test("does not fire below the threshold", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts")];
    expect(detectStuckLoop(input({ callLog }))).toEqual([]);
  });

  test("counts file-create alongside file-edit", () => {
    const callLog: ToolCallRecord[] = [call("file-create", { path: "src/a.ts" }), edit("src/a.ts"), edit("src/a.ts")];
    expect(detectStuckLoop(input({ callLog }))).toEqual([{ type: "stuck-loop", path: "src/a.ts", editCount: 3 }]);
  });

  test("resets after a successful test-run", () => {
    const callLog: ToolCallRecord[] = [
      edit("src/a.ts"),
      edit("src/a.ts"),
      edit("src/a.ts"),
      call("test-run", {}, "succeeded"),
      edit("src/a.ts"),
    ];
    expect(detectStuckLoop(input({ callLog }))).toEqual([]);
  });

  test("failed test-run does not reset the counter", () => {
    const callLog: ToolCallRecord[] = [
      edit("src/a.ts"),
      edit("src/a.ts"),
      call("test-run", {}, "failed"),
      edit("src/a.ts"),
    ];
    const out = detectStuckLoop(input({ callLog }));
    expect(out).toHaveLength(1);
    expect(out[0].editCount).toBe(3);
  });

  test("only counts edits to the most recent path", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/b.ts"), edit("src/b.ts")];
    expect(detectStuckLoop(input({ callLog }))).toEqual([]);
  });

  test("throttles while a recent stuck-loop reminder is present", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/a.ts")];
    const messages: LanguageModelV3Message[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      userReminderMessage("stuck-loop"),
      { role: "assistant", content: [{ type: "text", text: "working" }] },
    ];
    expect(detectStuckLoop(input({ messages, callLog }))).toEqual([]);
  });

  test("fires again after cooldown turns", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/a.ts")];
    const messages: LanguageModelV3Message[] = [
      userReminderMessage("stuck-loop"),
      ...Array.from<unknown, LanguageModelV3Message>({ length: 6 }, () => ({
        role: "assistant",
        content: [{ type: "text", text: "step" }],
      })),
    ];
    expect(detectStuckLoop(input({ messages, callLog }))).toHaveLength(1);
  });

  test("config overrides default threshold", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts")];
    expect(detectStuckLoop(input({ callLog, config: { stuckLoopSameFileThreshold: 1 } }))).toHaveLength(1);
  });

  test("ignores non-write tools", () => {
    const callLog: ToolCallRecord[] = [
      call("file-read", { path: "src/a.ts" }),
      call("file-read", { path: "src/a.ts" }),
      call("file-read", { path: "src/a.ts" }),
    ];
    expect(detectStuckLoop(input({ callLog }))).toEqual([]);
  });
});

describe("collectReminders", () => {
  test("returns empty when nothing fires", () => {
    expect(collectReminders(input({}))).toEqual([]);
  });

  test("aggregates fired reminders", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/a.ts")];
    const out = collectReminders(input({ callLog }));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("stuck-loop");
  });
});

describe("turnsSinceLastReminder", () => {
  test("returns Infinity when no matching reminder exists", () => {
    expect(turnsSinceLastReminder([], "stuck-loop")).toBe(Number.POSITIVE_INFINITY);
  });

  test("counts assistant turns since a matching reminder", () => {
    const messages: LanguageModelV3Message[] = [
      userReminderMessage("stuck-loop"),
      { role: "assistant", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
    ];
    expect(turnsSinceLastReminder(messages, "stuck-loop")).toBe(2);
  });

  test("ignores reminders of a different type", () => {
    const messages: LanguageModelV3Message[] = [
      userReminderMessage("budget-pressure"),
      { role: "assistant", content: [{ type: "text", text: "a" }] },
    ];
    expect(turnsSinceLastReminder(messages, "stuck-loop")).toBe(Number.POSITIVE_INFINITY);
  });
});
