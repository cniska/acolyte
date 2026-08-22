import { describe, expect, test } from "bun:test";
import type { ToolOutputPart } from "./tool-output-contract";
import { createToolOutputState, LIVE_TAIL_ROWS, renderToolOutput } from "./tool-output-render";

const shellLine = (text: string): ToolOutputPart => ({ kind: "shell-output", stream: "stdout", text });
const text = (part: ToolOutputPart | undefined): string | undefined =>
  part && part.kind === "shell-output" ? part.text : undefined;

function setup() {
  const state = createToolOutputState();
  const push = (content: ToolOutputPart, toolCallId = "tc_1") => state.push({ toolCallId, content });
  return { state, push };
}

describe("createToolOutputState", () => {
  test("returns items and label for tool-header", () => {
    const { push } = setup();
    const update = push({ kind: "tool-header", labelKey: "tool.label.file_find" });
    expect(update?.label).toBe("Find");
    expect(update?.items).toHaveLength(1);
  });

  test("extracts label from scope-header", () => {
    const { push } = setup();
    const update = push({
      kind: "scope-header",
      labelKey: "tool.label.file_find",
      scope: "workspace",
      patterns: ["*.ts"],
      matches: 2,
    });
    expect(update?.label).toBe("Find");
  });

  test("extracts label from file-header", () => {
    const { push } = setup();
    const update = push({ kind: "file-header", labelKey: "tool.label.file_read", count: 1, targets: ["a.ts"] });
    expect(update?.label).toBe("Read");
  });

  test("extracts label from edit-header", () => {
    const { push } = setup();
    const update = push({
      kind: "edit-header",
      labelKey: "tool.label.file_edit",
      path: "notes.ts",
      added: 1,
      removed: 1,
    });
    expect(update?.label).toBe("Edit");
  });

  test("accumulates items across pushes", () => {
    const { push } = setup();
    push({
      kind: "scope-header",
      labelKey: "tool.label.file_find",
      scope: "workspace",
      patterns: ["*.ts"],
      matches: 2,
    });
    push({ kind: "text", text: "a.ts" });
    const update = push({ kind: "text", text: "b.ts" });
    expect(update?.items).toHaveLength(3);
  });

  test("deduplicates identical consecutive items", () => {
    const { push } = setup();
    push({ kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" });
    push({ kind: "text", text: "out | a" });
    const update = push({ kind: "text", text: "out | a" });
    expect(update).toBeNull();
  });

  test("tracks independent tool calls", () => {
    const { state } = setup();
    state.push({
      toolCallId: "tc_1",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd1" },
    });
    state.push({
      toolCallId: "tc_2",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd2" },
    });
    const u1 = state.push({ toolCallId: "tc_1", content: { kind: "text", text: "a" } });
    const u2 = state.push({ toolCallId: "tc_2", content: { kind: "text", text: "b" } });
    expect(u1?.items).toHaveLength(2);
    expect(u2?.items).toHaveLength(2);
    expect(renderToolOutput(u1?.items ?? [])).toBe("Run cmd1\n  a");
    expect(renderToolOutput(u2?.items ?? [])).toBe("Run cmd2\n  b");
  });

  test("delete removes state for a tool call", () => {
    const { state } = setup();
    state.push({
      toolCallId: "tc_1",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" },
    });
    state.delete("tc_1");
    const update = state.push({
      toolCallId: "tc_1",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd2" },
    });
    expect(update?.items).toHaveLength(1);
  });

  test("transient parts render while the tool is still running", () => {
    const state = createToolOutputState();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.shell_run" } });
    state.push({ toolCallId: "tc_1", content: shellLine("first"), transient: true });
    const update = state.push({ toolCallId: "tc_1", content: shellLine("second"), transient: true });
    expect(update?.items.map(text)).toEqual([undefined, "first", "second"]);
  });

  test("a settled part replaces every transient part before it", () => {
    const state = createToolOutputState();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.shell_run" } });
    state.push({ toolCallId: "tc_1", content: shellLine("live-1"), transient: true });
    state.push({ toolCallId: "tc_1", content: shellLine("live-2"), transient: true });
    const update = state.push({ toolCallId: "tc_1", content: shellLine("settled") });
    expect(update?.items.map(text)).toEqual([undefined, "settled"]);
  });

  test("transient parts keep only the most recent rows", () => {
    const state = createToolOutputState();
    let update = null;
    for (let i = 1; i <= LIVE_TAIL_ROWS + 3; i++) {
      update = state.push({ toolCallId: "tc_1", content: shellLine(`line-${i}`), transient: true });
    }
    expect(update?.items).toHaveLength(LIVE_TAIL_ROWS);
    expect(text(update?.items[0])).toBe("line-4");
  });
});
