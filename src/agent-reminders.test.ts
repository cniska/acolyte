import { describe, expect, test } from "bun:test";
import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { collectReminders, detectStuckLoop, turnsSinceLastReminder } from "./agent-reminders";
import { renderReminder, wrapInSystemReminder } from "./agent-reminders-render";
import type { ToolCallRecord, ToolCallStatus } from "./tool-session";

const WRITE_TOOL_SET = new Set(["file-edit", "file-create"]);

function edit(path: string, status: ToolCallStatus = "succeeded"): ToolCallRecord {
  return { toolName: "file-edit", args: { path }, status };
}

function createCall(
  toolName: string,
  args: Record<string, unknown>,
  status: ToolCallStatus = "succeeded",
): ToolCallRecord {
  return { toolName, args, status };
}

function userReminderMessage(type: string): LanguageModelV3Message {
  return {
    role: "user",
    content: [{ type: "text", text: `<system-reminder type="${type}">\nprior\n</system-reminder>` }],
  };
}

const EMPTY_MESSAGES: LanguageModelV3Message[] = [];

describe("wrapInSystemReminder", () => {
  test("wraps text with typed tags", () => {
    const wrapped = wrapInSystemReminder("stuck-loop", "hi");
    expect(wrapped).toBe('<system-reminder type="stuck-loop">\nhi\n</system-reminder>');
  });
});

describe("renderReminder", () => {
  test("renders stuck-loop as a role:user message with wrapped content", () => {
    const msg = renderReminder({ type: "stuck-loop", path: "src/a.ts", editCount: 3 });
    expect(msg.role).toBe("user");
    expect(Array.isArray(msg.content)).toBe(true);
    const part = (msg.content as { type: string; text: string }[])[0];
    expect(part.type).toBe("text");
    expect(part.text).toContain('<system-reminder type="stuck-loop">');
    expect(part.text).toContain("src/a.ts");
    expect(part.text).toContain("3 times");
  });
});

describe("detectStuckLoop", () => {
  test("fires at the configured threshold", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/a.ts")];
    const out = detectStuckLoop({ messages: EMPTY_MESSAGES, callLog, writeToolSet: WRITE_TOOL_SET });
    expect(out).toEqual([{ type: "stuck-loop", path: "src/a.ts", editCount: 3 }]);
  });

  test("does not fire below the threshold", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts")];
    expect(detectStuckLoop({ messages: EMPTY_MESSAGES, callLog, writeToolSet: WRITE_TOOL_SET })).toEqual([]);
  });

  test("resets after a successful test-run", () => {
    const callLog: ToolCallRecord[] = [
      edit("src/a.ts"),
      edit("src/a.ts"),
      edit("src/a.ts"),
      createCall("test-run", {}, "succeeded"),
      edit("src/a.ts"),
    ];
    expect(detectStuckLoop({ messages: EMPTY_MESSAGES, callLog, writeToolSet: WRITE_TOOL_SET })).toEqual([]);
  });

  test("failed test-run does not reset the counter", () => {
    const callLog: ToolCallRecord[] = [
      edit("src/a.ts"),
      edit("src/a.ts"),
      createCall("test-run", {}, "failed"),
      edit("src/a.ts"),
    ];
    const out = detectStuckLoop({ messages: EMPTY_MESSAGES, callLog, writeToolSet: WRITE_TOOL_SET });
    expect(out).toHaveLength(1);
    expect(out[0].editCount).toBe(3);
  });

  test("only counts edits to the most recent path", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/b.ts"), edit("src/b.ts")];
    const out = detectStuckLoop({ messages: EMPTY_MESSAGES, callLog, writeToolSet: WRITE_TOOL_SET });
    expect(out).toEqual([]);
  });

  test("throttles while a recent stuck-loop reminder is present", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/a.ts")];
    const messages: LanguageModelV3Message[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      userReminderMessage("stuck-loop"),
      { role: "assistant", content: [{ type: "text", text: "working" }] },
    ];
    const out = detectStuckLoop({ messages, callLog, writeToolSet: WRITE_TOOL_SET });
    expect(out).toEqual([]);
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
    const out = detectStuckLoop({ messages, callLog, writeToolSet: WRITE_TOOL_SET });
    expect(out).toHaveLength(1);
  });

  test("config overrides default threshold", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts")];
    const out = detectStuckLoop({
      messages: EMPTY_MESSAGES,
      callLog,
      writeToolSet: WRITE_TOOL_SET,
      config: { stuckLoopSameFileThreshold: 1 },
    });
    expect(out).toHaveLength(1);
  });

  test("ignores non-write tools", () => {
    const callLog: ToolCallRecord[] = [
      createCall("file-read", { path: "src/a.ts" }),
      createCall("file-read", { path: "src/a.ts" }),
      createCall("file-read", { path: "src/a.ts" }),
    ];
    expect(detectStuckLoop({ messages: EMPTY_MESSAGES, callLog, writeToolSet: WRITE_TOOL_SET })).toEqual([]);
  });
});

describe("collectReminders", () => {
  test("returns empty when nothing fires", () => {
    expect(collectReminders({ messages: EMPTY_MESSAGES, callLog: [], writeToolSet: WRITE_TOOL_SET })).toEqual([]);
  });

  test("aggregates fired reminders", () => {
    const callLog: ToolCallRecord[] = [edit("src/a.ts"), edit("src/a.ts"), edit("src/a.ts")];
    const out = collectReminders({ messages: EMPTY_MESSAGES, callLog, writeToolSet: WRITE_TOOL_SET });
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
