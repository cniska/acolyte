import { describe, expect, test } from "bun:test";
import { createProgressTracker } from "./chat-progress";
import type { StreamEvent } from "./client";

describe("chat progress tracker", () => {
  test("routes text-delta to onAssistant", () => {
    const deltas: string[] = [];
    const tracker = createProgressTracker({
      onAssistant: (delta) => deltas.push(delta),
    });

    tracker.apply({ type: "text-delta", text: "Hello " });
    tracker.apply({ type: "text-delta", text: "world" });

    expect(deltas).toEqual(["Hello ", "world"]);
  });

  test("routes reasoning to onReasoning", () => {
    const deltas: string[] = [];
    const tracker = createProgressTracker({
      onReasoning: (delta) => deltas.push(delta),
    });

    tracker.apply({ type: "reasoning", text: "Let me think..." });

    expect(deltas).toEqual(["Let me think..."]);
  });

  test("routes tool-call to onToolCall", () => {
    const calls: Array<{ toolCallId: string; toolName: string }> = [];
    const tracker = createProgressTracker({
      onToolCall: (entry) => calls.push({ toolCallId: entry.toolCallId, toolName: entry.toolName }),
    });

    tracker.apply({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "read-file",
      args: { path: "src/foo.ts" },
    });

    expect(calls).toEqual([{ toolCallId: "call_1", toolName: "read-file" }]);
  });

  test("routes tool-output to onToolOutput", () => {
    const outputs: Array<{ toolCallId: string; content: string }> = [];
    const tracker = createProgressTracker({
      onToolOutput: (entry) => outputs.push({ toolCallId: entry.toolCallId, content: entry.content }),
    });

    tracker.apply({
      type: "tool-output",
      toolCallId: "call_1",
      toolName: "read-file",
      content: "1  import { foo }",
    });

    expect(outputs).toEqual([{ toolCallId: "call_1", content: "1  import { foo }" }]);
  });

  test("routes tool-result to onToolResult", () => {
    const results: Array<{ toolCallId: string; isError?: boolean }> = [];
    const tracker = createProgressTracker({
      onToolResult: (entry) => results.push({ toolCallId: entry.toolCallId, isError: entry.isError }),
    });

    tracker.apply({ type: "tool-result", toolCallId: "call_1", toolName: "read-file" });
    tracker.apply({ type: "tool-result", toolCallId: "call_2", toolName: "edit-file", isError: true });

    expect(results).toEqual([
      { toolCallId: "call_1", isError: undefined },
      { toolCallId: "call_2", isError: true },
    ]);
  });

  test("routes status to onStatus", () => {
    const statuses: string[] = [];
    const tracker = createProgressTracker({
      onStatus: (message) => statuses.push(message),
    });

    tracker.apply({ type: "status", message: "Working…" });

    expect(statuses).toEqual(["Working…"]);
  });

  test("routes error to onError", () => {
    const errors: string[] = [];
    const tracker = createProgressTracker({
      onError: (error) => errors.push(error),
    });

    tracker.apply({ type: "error", error: "Tool failed: timeout" });

    expect(errors).toEqual(["Tool failed: timeout"]);
  });

  test("handles full tool lifecycle in order", () => {
    const log: string[] = [];
    const tracker = createProgressTracker({
      onToolCall: (e) => log.push(`call:${e.toolName}`),
      onToolOutput: (e) => log.push(`output:${e.content}`),
      onToolResult: (e) => log.push(`result:${e.toolName}`),
    });

    const events: StreamEvent[] = [
      { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
      { type: "tool-output", toolCallId: "call_1", toolName: "edit-file", content: "1 + fn main() {}" },
      { type: "tool-result", toolCallId: "call_1", toolName: "edit-file" },
    ];

    for (const event of events) {
      tracker.apply(event);
    }

    expect(log).toEqual(["call:edit-file", "output:1 + fn main() {}", "result:edit-file"]);
  });

  test("silently ignores events when no handler is registered", () => {
    const tracker = createProgressTracker({});

    // Should not throw
    tracker.apply({ type: "text-delta", text: "Hello" });
    tracker.apply({ type: "tool-call", toolCallId: "c1", toolName: "read-file", args: {} });
    tracker.apply({ type: "status", message: "Working…" });
    tracker.apply({ type: "error", error: "boom" });
  });
});
