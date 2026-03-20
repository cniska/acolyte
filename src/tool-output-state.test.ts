import { describe, expect, test } from "bun:test";
import { createToolOutputState, formatToolOutput, type ToolOutputPart } from "./tool-output-content";

function setup() {
  const state = createToolOutputState();
  const push = (content: ToolOutputPart, toolCallId = "tc_1") => state.push({ toolCallId, content });
  return { state, push };
}

describe("createToolOutputState", () => {
  test("returns items and label for tool-header", () => {
    const { push } = setup();
    const update = push({ kind: "tool-header", labelKey: "find" });
    expect(update?.label).toBe("Find");
    expect(update?.items).toHaveLength(1);
  });

  test("extracts label from scope-header", () => {
    const { push } = setup();
    const update = push({ kind: "scope-header", labelKey: "find", scope: "workspace", patterns: ["*.ts"], matches: 2 });
    expect(update?.label).toBe("Find");
  });

  test("extracts label from file-header", () => {
    const { push } = setup();
    const update = push({ kind: "file-header", labelKey: "read", count: 1, targets: ["a.ts"] });
    expect(update?.label).toBe("Read");
  });

  test("extracts label from edit-header", () => {
    const { push } = setup();
    const update = push({ kind: "edit-header", labelKey: "edit", path: "notes.ts", files: 1, added: 1, removed: 1 });
    expect(update?.label).toBe("Edit");
  });

  test("accumulates items across pushes", () => {
    const { push } = setup();
    push({ kind: "scope-header", labelKey: "find", scope: "workspace", patterns: ["*.ts"], matches: 2 });
    push({ kind: "text", text: "a.ts" });
    const update = push({ kind: "text", text: "b.ts" });
    expect(update?.items).toHaveLength(3);
  });

  test("deduplicates identical consecutive items", () => {
    const { push } = setup();
    push({ kind: "tool-header", labelKey: "run", detail: "cmd" });
    push({ kind: "text", text: "out | a" });
    const update = push({ kind: "text", text: "out | a" });
    expect(update).toBeNull();
  });

  test("tracks independent tool calls", () => {
    const { state } = setup();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "run", detail: "cmd1" } });
    state.push({ toolCallId: "tc_2", content: { kind: "tool-header", labelKey: "run", detail: "cmd2" } });
    const u1 = state.push({ toolCallId: "tc_1", content: { kind: "text", text: "a" } });
    const u2 = state.push({ toolCallId: "tc_2", content: { kind: "text", text: "b" } });
    expect(u1?.items).toHaveLength(2);
    expect(u2?.items).toHaveLength(2);
    expect(formatToolOutput(u1?.items ?? [])).toBe("Run cmd1\n  a");
    expect(formatToolOutput(u2?.items ?? [])).toBe("Run cmd2\n  b");
  });

  test("delete removes state for a tool call", () => {
    const { state } = setup();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "run", detail: "cmd" } });
    state.delete("tc_1");
    const update = state.push({
      toolCallId: "tc_1",
      content: { kind: "tool-header", labelKey: "run", detail: "cmd2" },
    });
    expect(update?.items).toHaveLength(1);
  });
});
