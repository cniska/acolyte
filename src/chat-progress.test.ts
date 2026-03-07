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

  test("tool-call event is accepted without error", () => {
    const tracker = createProgressTracker({});
    tracker.apply({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "read-file",
      args: { path: "src/foo.ts" },
    });
  });

  test("routes tool-output to onOutput", () => {
    const outputs: Array<{ toolCallId: string; content: string }> = [];
    const tracker = createProgressTracker({
      onOutput: (entry) =>
        outputs.push({
          toolCallId: entry.toolCallId,
          content: entry.content.kind === "text" ? entry.content.text : entry.content.kind,
        }),
    });

    tracker.apply({
      type: "tool-output",
      toolCallId: "call_1",
      toolName: "read-file",
      content: { kind: "text", text: "1  import { foo }" },
    });

    expect(outputs).toEqual([{ toolCallId: "call_1", content: "1  import { foo }" }]);
  });

  test("routes tool-result to onToolResult", () => {
    const results: Array<{ toolCallId: string; isError?: boolean; errorCode?: string }> = [];
    const tracker = createProgressTracker({
      onToolResult: (entry) =>
        results.push({ toolCallId: entry.toolCallId, isError: entry.isError, errorCode: entry.errorCode }),
    });

    tracker.apply({ type: "tool-result", toolCallId: "call_1", toolName: "read-file" });
    tracker.apply({
      type: "tool-result",
      toolCallId: "call_2",
      toolName: "edit-file",
      isError: true,
      errorCode: "E_GUARD_BLOCKED",
    });

    expect(results).toEqual([
      { toolCallId: "call_1", isError: undefined, errorCode: undefined },
      { toolCallId: "call_2", isError: true, errorCode: "E_GUARD_BLOCKED" },
    ]);
  });

  test("routes status to onStatus", () => {
    const statuses: string[] = [];
    const tracker = createProgressTracker({
      onStatus: (message) => statuses.push(message),
    });

    tracker.apply({ type: "status", message: "Thinking…" });

    expect(statuses).toEqual(["Thinking…"]);
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
      onOutput: (e) => log.push(`output:${e.content.kind === "text" ? e.content.text : e.content.kind}`),
      onToolResult: (e) => log.push(`result:${e.toolName}`),
    });

    const events: StreamEvent[] = [
      { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
      {
        type: "tool-output",
        toolCallId: "call_1",
        toolName: "edit-file",
        content: { kind: "tool-header", label: "Edit" },
      },
      {
        type: "tool-output",
        toolCallId: "call_1",
        toolName: "edit-file",
        content: { kind: "diff", lineNumber: 1, marker: "add", text: "fn main() {}" },
      },
      { type: "tool-result", toolCallId: "call_1", toolName: "edit-file" },
    ];

    for (const event of events) {
      tracker.apply(event);
    }

    expect(log).toEqual(["output:tool-header", "output:diff", "result:edit-file"]);
  });

  test("silently ignores events when no handler is registered", () => {
    const tracker = createProgressTracker({});

    // Should not throw
    tracker.apply({ type: "text-delta", text: "Hello" });
    tracker.apply({ type: "tool-call", toolCallId: "c1", toolName: "read-file", args: {} });
    tracker.apply({ type: "status", message: "Thinking…" });
    tracker.apply({ type: "error", error: "boom" });
  });
});
