import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-commands";
import { createMessageStreamState } from "./chat-message-handler-stream";

function createRowsHarness(): {
  rows: ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
} {
  const rows: ChatRow[] = [];
  const setRows = (updater: (current: ChatRow[]) => ChatRow[]): void => {
    rows.splice(0, rows.length, ...updater(rows));
  };
  return { rows, setRows };
}

describe("chat-message-handler-stream", () => {
  test("flushes streaming assistant content into a single mutable row", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onAssistantDelta("hello");
    state.flushStreamingContent();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("assistant");
    expect(rows[0]?.content).toBe("hello");

    state.onAssistantDelta(" world");
    state.flushStreamingContent();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe("hello world");
  });

  test("materializes tool header and appends output lines", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onToolCall({ toolCallId: "call_1", toolName: "read-file", args: { path: "a.ts" } });
    state.flushPendingToolRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.style).toBe("toolProgress");
    expect((rows[0]?.content ?? "").length > 0).toBe(true);

    state.onToolOutput({ toolCallId: "call_1", toolName: "read-file", content: "line A" });
    state.onToolOutput({ toolCallId: "call_1", toolName: "read-file", content: "line A" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content.includes("line A")).toBe(true);
    expect(rows[0]?.content.split("line A").length - 1).toBe(1);
  });

  test("removes guard-blocked tool rows", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onToolCall({ toolCallId: "call_blocked", toolName: "run-command", args: { command: "echo hi" } });
    state.flushPendingToolRows();
    expect(rows).toHaveLength(1);

    state.onToolResult({
      toolCallId: "call_blocked",
      toolName: "run-command",
      isError: true,
      errorCode: "E_GUARD_BLOCKED",
      errorDetail: { category: "guard-blocked" },
    });
    expect(rows).toHaveLength(0);
  });
});
