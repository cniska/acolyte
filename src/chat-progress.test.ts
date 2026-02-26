import { describe, expect, test } from "bun:test";
import { createProgressTracker } from "./chat-progress";

describe("chat progress tracker", () => {
  test("forwards tool events in order", () => {
    const received: Array<{ message: string; toolCallId?: string; phase?: "tool_start" | "tool_chunk" | "tool_end" }> =
      [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        received.push({ message: entry.message, toolCallId: entry.toolCallId, phase: entry.phase });
      },
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "tool_start" },
      { seq: 2, message: "1 + fn main() {}", kind: "tool", toolCallId: "call_1", phase: "tool_chunk" },
      { seq: 3, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "tool_end" },
    ]);

    expect(received).toEqual([
      { message: "Edited sum.rs", toolCallId: "call_1", phase: "tool_start" },
      { message: "1 + fn main() {}", toolCallId: "call_1", phase: "tool_chunk" },
      { message: "Edited sum.rs", toolCallId: "call_1", phase: "tool_end" },
    ]);
  });

  test("keeps identical headers for different tool calls", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push(entry.message);
      },
    });

    tracker.apply([{ seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "tool_start" }]);
    tracker.apply([{ seq: 2, message: "Edited sum.rs", kind: "tool", toolCallId: "call_2", phase: "tool_start" }]);

    expect(toolMessages).toEqual(["Edited sum.rs", "Edited sum.rs"]);
  });

  test("forwards assistant deltas without trimming", () => {
    const deltas: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onAssistant: (delta) => {
        deltas.push(delta);
      },
      onTool: () => {},
    });

    tracker.apply([
      { seq: 1, message: "I will ", kind: "assistant" },
      { seq: 2, message: "edit sum.rs\n", kind: "assistant" },
    ]);

    expect(deltas).toEqual(["I will ", "edit sum.rs\n"]);
  });

  test("suppresses exact duplicate tool events by default", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push(entry.message);
      },
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "tool_start" },
      { seq: 2, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "tool_start" },
    ]);

    expect(toolMessages).toEqual(["Edited sum.rs"]);
  });

  test("distinguishes tool_start and tool_end with same message", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push(entry.message);
      },
    });

    tracker.apply([
      { seq: 1, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "tool_start" },
      { seq: 2, message: "Edited sum.rs", kind: "tool", toolCallId: "call_1", phase: "tool_end" },
    ]);

    expect(toolMessages).toEqual(["Edited sum.rs", "Edited sum.rs"]);
  });

  test("does not deduplicate events from different tools with same message", () => {
    const toolMessages: string[] = [];
    const tracker = createProgressTracker({
      onStatus: () => {},
      onTool: (entry) => {
        toolMessages.push(entry.message);
      },
    });

    tracker.apply([
      {
        seq: 1,
        message: "Read src/cli.ts",
        kind: "tool",
        toolCallId: "call_1",
        toolName: "read-file",
        phase: "tool_start",
      },
      {
        seq: 2,
        message: "Read src/cli.ts",
        kind: "tool",
        toolCallId: "call_2",
        toolName: "read-file",
        phase: "tool_start",
      },
    ]);

    expect(toolMessages).toEqual(["Read src/cli.ts", "Read src/cli.ts"]);
  });
});
