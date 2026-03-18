import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { isToolOutput } from "./chat-contract";
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
  test("accumulates assistant deltas and exposes via streamedAssistantText", () => {
    const { setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onAssistantDelta("hello");
    state.onAssistantDelta(" world");
    expect(state.streamedAssistantText()).toBe("hello world");
    state.dispose();
  });

  test("finalize returns pending row id and clears state", async () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onAssistantDelta("hello");
    // Force flush via timer
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rows).toHaveLength(1);
    const rowId = state.finalize();
    expect(rowId).toBeTruthy();
    expect(state.streamedAssistantText()).toBe("");
    state.dispose();
  });

  test("accumulates tool output with single header", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "search-files",
      content: { kind: "scope-header", label: "Search", scope: "workspace", patterns: ["needle"], matches: 2 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("tool");
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(1);

    state.onOutput({
      toolCallId: "call_1",
      toolName: "search-files",
      content: { kind: "text", text: "a.ts [needle@1]" },
    });
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(2);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts[1]).toEqual({
      kind: "text",
      text: "a.ts [needle@1]",
    });
    state.dispose();
  });

  test("deduplicates identical output items", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "edit-file",
      content: { kind: "edit-header", label: "Edit", path: "a.ts", files: 1, added: 1, removed: 0 },
    });
    state.onOutput({ toolCallId: "call_1", toolName: "edit-file", content: { kind: "text", text: "line A" } });
    state.onOutput({ toolCallId: "call_1", toolName: "edit-file", content: { kind: "text", text: "line A" } });
    expect(rows).toHaveLength(1);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(2);
    state.dispose();
  });

  test("removes guard-blocked tool rows", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onOutput({
      toolCallId: "call_blocked",
      toolName: "run-command",
      content: { kind: "tool-header", label: "Run", detail: "echo hi" },
    });
    expect(rows).toHaveLength(1);

    state.onToolResult({
      toolCallId: "call_blocked",
      toolName: "run-command",
      isError: true,
      errorCode: "E_GUARD_BLOCKED",
      error: { category: "guard-blocked" },
    });
    expect(rows).toHaveLength(0);
    state.dispose();
  });
});
