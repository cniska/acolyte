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
  test("accumulates agent deltas and exposes via streamedText", () => {
    const { setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onDelta("hello");
    state.onDelta(" world");
    expect(state.streamedText()).toBe("hello world");
    state.dispose();
  });

  test("finalize returns pending row id and clears state", async () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onDelta("hello");
    // Force flush via timer
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rows).toHaveLength(1);
    const rowId = state.finalize();
    expect(rowId).toBeTruthy();
    expect(state.streamedText()).toBe("");
    state.dispose();
  });

  test("accumulates tool output with single header", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-search",
      content: {
        kind: "scope-header",
        labelKey: "tool.label.file_search",
        scope: "workspace",
        patterns: ["needle"],
        matches: 2,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("tool");
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(1);

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-search",
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
      toolName: "file-edit",
      content: { kind: "edit-header", labelKey: "tool.label.file_edit", path: "a.ts", files: 1, added: 1, removed: 0 },
    });
    state.onOutput({ toolCallId: "call_1", toolName: "file-edit", content: { kind: "text", text: "line A" } });
    state.onOutput({ toolCallId: "call_1", toolName: "file-edit", content: { kind: "text", text: "line A" } });
    expect(rows).toHaveLength(1);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(2);
    state.dispose();
  });

  test("agent text row appears before tool row when text arrives first", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    // Agent emits text, then a tool call arrives — text should be flushed before the tool row.
    state.onDelta("Reading the file.");
    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "src/a.ts" },
    });

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const agentIndex = rows.findIndex((r) => r.kind === "assistant");
    const toolIndex = rows.findIndex((r) => r.kind === "tool");
    expect(agentIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(agentIndex);
    state.dispose();
  });

  test("finalize keeps tool rows and returns only agent row ids", async () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    // Simulate: agent text → tool call → more agent text
    state.onDelta("thinking...");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("assistant");

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.kind).toBe("tool");

    state.onDelta("done now");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rows).toHaveLength(3);

    const streamingIds = state.finalize();
    // finalize should return only agent row ids, not tool row ids
    const toolRows = rows.filter((r) => r.kind === "tool");
    expect(toolRows).toHaveLength(1);
    for (const toolRow of toolRows) {
      expect(streamingIds).not.toContain(toolRow.id);
    }

    // Simulate handler replacement: content rows at streaming position, status at end
    const removeSet = new Set(streamingIds);
    const contentRows: ChatRow[] = [{ id: "final_assistant", kind: "assistant", content: "done" }];
    const statusRows: ChatRow[] = [{ id: "final_status", kind: "status", content: "Worked 5s" }];
    const filtered = rows.filter((row) => !removeSet.has(row.id));
    const insertIndex = rows.findIndex((row) => removeSet.has(row.id));
    if (insertIndex >= 0) filtered.splice(insertIndex, 0, ...contentRows);
    else filtered.push(...contentRows);
    filtered.push(...statusRows);

    // Tool rows should appear BEFORE the status row
    const toolIndex = filtered.findIndex((r) => r.kind === "tool");
    const statusIndex = filtered.findIndex((r) => r.kind === "status");
    expect(toolIndex).toBeLessThan(statusIndex);
  });

  test("removes budget-exhausted tool rows", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onOutput({
      toolCallId: "call_blocked",
      toolName: "shell-run",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "echo hi" },
    });
    expect(rows).toHaveLength(1);

    state.onToolResult({
      toolCallId: "call_blocked",
      toolName: "shell-run",
      isError: true,
      errorCode: "E_GUARD_BLOCKED",
      error: { category: "budget-exhausted" },
    });
    expect(rows).toHaveLength(0);
    state.dispose();
  });
});
