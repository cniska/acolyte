import { describe, expect, test } from "bun:test";
import { createProgressTracker } from "./chat-progress";

describe("chat progress tracker", () => {
  test("groups split tool header/detail lines within one progress batch", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push(entry.message);
      },
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool" },
      { seq: 2, message: "1 + fn main() {}", kind: "tool" },
      { seq: 3, message: "Deleted sum.rs", kind: "tool" },
    ]);

    expect(toolMessages).toEqual(["Edited sum.rs\n1 + fn main() {}", "Deleted sum.rs"]);
  });

  test("dedupes grouped tool messages by default for same tool call", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push(entry.message);
      },
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "start" },
      { seq: 2, message: "1 + fn main() {}", kind: "tool", toolCallId: "call_1", phase: "result" },
    ]);
    tracker.apply([
      { seq: 3, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "start" },
      { seq: 4, message: "1 + fn main() {}", kind: "tool", toolCallId: "call_1", phase: "result" },
    ]);

    expect(toolMessages).toEqual(["Edited sum.rs\n1 + fn main() {}"]);
  });

  test("keeps identical tool headers for different tool calls", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push(entry.message);
      },
    });

    tracker.apply([{ seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "start" }]);
    tracker.apply([{ seq: 2, message: "Edited sum.rs", kind: "tool", toolCallId: "call_2", phase: "start" }]);

    expect(toolMessages).toEqual(["Edited sum.rs", "Edited sum.rs"]);
  });

  test("forwards tool metadata to onTool callback", () => {
    const received: Array<{ message: string; toolCallId?: string; phase?: "start" | "result" | "error" }> = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        received.push({ message: entry.message, toolCallId: entry.toolCallId, phase: entry.phase });
      },
    });

    tracker.apply([{ seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "start" }]);

    expect(received).toEqual([{ message: "Edited sum.rs", toolCallId: "call_1", phase: "start" }]);
  });

  test("groups by toolCallId even when events are interleaved", () => {
    const toolMessages: Array<{ message: string; toolCallId?: string }> = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push({ message: entry.message, toolCallId: entry.toolCallId });
      },
      dedupeToolMessages: false,
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "start" },
      { seq: 2, message: "Edited sum.rs", kind: "tool", toolCallId: "call_2", phase: "start" },
      { seq: 3, message: "1 + fn one() {}", kind: "tool", toolCallId: "call_1", phase: "result" },
      { seq: 4, message: "1 + fn two() {}", kind: "tool", toolCallId: "call_2", phase: "result" },
    ]);

    expect(toolMessages).toEqual([
      { message: "Edited sum.rs\n1 + fn one() {}", toolCallId: "call_1" },
      { message: "Edited sum.rs\n1 + fn two() {}", toolCallId: "call_2" },
    ]);
  });

  test("does not append duplicate detail lines for same toolCallId", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push(entry.message);
      },
      dedupeToolMessages: false,
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "start" },
      { seq: 2, message: "1 + fn main() {}", kind: "tool", toolCallId: "call_1", phase: "result" },
      { seq: 3, message: "1 + fn main() {}", kind: "tool", toolCallId: "call_1", phase: "result" },
    ]);

    expect(toolMessages).toEqual(["Edited sum.rs\n1 + fn main() {}"]);
  });

});
