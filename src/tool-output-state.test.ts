import { describe, expect, test } from "bun:test";
import type { ToolOutputPart } from "./tool-output-contract";
import { shellTailParts } from "./tool-output-format";
import { createToolOutputState, renderToolOutput } from "./tool-output-render";
import { OUTPUT_WINDOW_ROWS } from "./tool-policy";

const shellLine = (text: string): ToolOutputPart => ({ kind: "shell-output", stream: "stdout", text });
const text = (part: ToolOutputPart | undefined): string | undefined =>
  part && part.kind === "shell-output" ? part.text : undefined;

function setup() {
  const state = createToolOutputState({ surface: "transcript" });
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

  test("a line the tool printed twice is shown twice", () => {
    const { push } = setup();
    push({ kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" });
    push({ kind: "text", text: "out | a" });
    const update = push({ kind: "text", text: "out | a" });
    expect(update?.items).toHaveLength(3);
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
    const state = createToolOutputState({ surface: "transcript" });
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.shell_run" } });
    state.push({ toolCallId: "tc_1", content: shellLine("first"), transient: true });
    const update = state.push({ toolCallId: "tc_1", content: shellLine("second"), transient: true });
    expect(update?.items.map(text)).toEqual([undefined, "first", "second"]);
  });

  test("a stream surface drops transient parts and keeps the rest", () => {
    const state = createToolOutputState({ surface: "stream" });
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.shell_run" } });
    expect(state.push({ toolCallId: "tc_1", content: shellLine("live"), transient: true })).toBeNull();
    const update = state.push({ toolCallId: "tc_1", content: shellLine("settled") });
    expect(update?.items.map(text)).toEqual([undefined, "settled"]);
  });

  test("a kept part replaces every transient part before it", () => {
    const state = createToolOutputState({ surface: "transcript" });
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.shell_run" } });
    state.push({ toolCallId: "tc_1", content: shellLine("live-1"), transient: true });
    state.push({ toolCallId: "tc_1", content: shellLine("live-2"), transient: true });
    const update = state.push({ toolCallId: "tc_1", content: shellLine("settled") });
    expect(update?.items.map(text)).toEqual([undefined, "settled"]);
  });

  test("transient parts keep the most recent rows and say how many the window dropped", () => {
    const state = createToolOutputState({ surface: "transcript" });
    let update = null;
    for (let i = 1; i <= OUTPUT_WINDOW_ROWS + 3; i++) {
      update = state.push({ toolCallId: "tc_1", content: shellLine(`line-${i}`), transient: true });
    }
    expect(update?.items[0]).toEqual({ kind: "truncated", count: 3, unit: "lines" });
    expect(text(update?.items[1])).toBe("line-4");
    expect(text(update?.items[OUTPUT_WINDOW_ROWS])).toBe(`line-${OUTPUT_WINDOW_ROWS + 3}`);
  });

  test("a live tail inside the window reports no truncation", () => {
    const state = createToolOutputState({ surface: "transcript" });
    let update = null;
    for (let i = 1; i <= OUTPUT_WINDOW_ROWS; i++) {
      update = state.push({ toolCallId: "tc_1", content: shellLine(`line-${i}`), transient: true });
    }
    expect(update?.items).toHaveLength(OUTPUT_WINDOW_ROWS);
    expect(update?.items.some((part) => part.kind === "truncated")).toBe(false);
  });

  test("a settled call drops the live tail's truncation count", () => {
    const state = createToolOutputState({ surface: "transcript" });
    for (let i = 1; i <= OUTPUT_WINDOW_ROWS + 3; i++) {
      state.push({ toolCallId: "tc_1", content: shellLine(`line-${i}`), transient: true });
    }
    const update = state.push({ toolCallId: "tc_1", content: shellLine("settled") });

    expect(update?.items.map(text)).toEqual(["settled"]);
  });

  test("output past the window keeps the header and the most recent rows", () => {
    const { state } = setup();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.file_create" } });
    let update = null;
    for (let i = 1; i <= OUTPUT_WINDOW_ROWS + 5; i++) {
      update = state.push({ toolCallId: "tc_1", content: shellLine(`line-${i}`) });
    }
    expect(update?.items).toHaveLength(OUTPUT_WINDOW_ROWS + 2);
    expect(update?.items[1]).toEqual({ kind: "truncated", count: 5, unit: "lines" });
    expect(text(update?.items[2])).toBe("line-6");
    expect(text(update?.items[OUTPUT_WINDOW_ROWS + 1])).toBe(`line-${OUTPUT_WINDOW_ROWS + 5}`);
  });

  test("a refined header replaces the one already placed", () => {
    const { state } = setup();
    const header = (summary?: string): ToolOutputPart => ({
      kind: "file-header",
      labelKey: "tool.label.file_read",
      count: 1,
      targets: ["a.ts"],
      ...(summary ? { summary } : {}),
    });
    state.push({ toolCallId: "tc_1", content: header() });
    const update = state.push({ toolCallId: "tc_1", content: header("1-400") });
    expect(update?.items).toHaveLength(1);
    expect(renderToolOutput(update?.items ?? [])).toBe("Read a.ts · 1-400");
  });

  // A command's preview arrives already sized to the window, so every row of it survives and the
  // truncation line rides along without costing the tail its oldest row.
  test("a command's preview fills the window beside its truncation line", () => {
    const { state } = setup();
    const lines = Array.from({ length: 40 }, (_, i) => ({ stream: "stdout" as const, text: `line-${i + 1}` }));
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.shell_run" } });
    let update = null;
    for (const part of shellTailParts(lines, OUTPUT_WINDOW_ROWS)) {
      update = state.push({ toolCallId: "tc_1", content: part });
    }
    expect(update?.items).toHaveLength(OUTPUT_WINDOW_ROWS + 2);
    expect(update?.items[1]).toEqual({ kind: "truncated", count: 30, unit: "lines" });
    expect(text(update?.items[2])).toBe("line-31");
    expect(text(update?.items[update.items.length - 1])).toBe("line-40");
  });

  // A tail with nothing above it reads as the whole output. What the window drops is stated, so the
  // reader knows they are looking at the end of something longer.
  test("a window that drops rows says how many", () => {
    const { state } = setup();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.shell_run" } });
    let update = null;
    for (let line = 1; line <= OUTPUT_WINDOW_ROWS + 5; line++) {
      update = state.push({ toolCallId: "tc_1", content: shellLine(`line-${line}`) });
    }
    expect(update?.items[1]).toEqual({ kind: "truncated", count: 5, unit: "lines" });
    expect(text(update?.items[2])).toBe("line-6");
    expect(update?.items).toHaveLength(OUTPUT_WINDOW_ROWS + 2);
  });

  // A preview that already stated an omission is trimmed again by the window. The two counts must
  // add up, or the reader is told less was withheld than was.
  test("a preview trimmed further states every row it dropped", () => {
    const { state } = setup();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.file_create" } });
    state.push({ toolCallId: "tc_1", content: { kind: "text", text: "head" } });
    state.push({ toolCallId: "tc_1", content: { kind: "truncated", count: 16, unit: "lines" } });
    let update = null;
    for (let line = 1; line <= OUTPUT_WINDOW_ROWS; line++) {
      update = state.push({ toolCallId: "tc_1", content: shellLine(`tail-${line}`) });
    }
    // The head row and the 16 it stood in front of are both gone: 17 rows, stated once.
    expect(update?.items[1]).toEqual({ kind: "truncated", count: 17, unit: "lines" });
    expect(update?.items.filter((part) => part.kind === "truncated")).toHaveLength(1);
  });

  // The workspace holds the state a change produced, never the change, and the next edit to the
  // same file takes even that away. Trimming a diff loses the only record of it.
  test("a diff is never windowed", () => {
    const { state } = setup();
    const rows = OUTPUT_WINDOW_ROWS + 30;
    state.push({
      toolCallId: "tc_1",
      content: { kind: "edit-header", labelKey: "tool.label.file_edit", path: "a.ts", added: 20, removed: 20 },
    });
    let update = null;
    for (let line = 1; line <= rows; line++) {
      update = state.push({
        toolCallId: "tc_1",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `l${line}` },
      });
    }
    expect(update?.items).toHaveLength(rows + 1);
    expect(update?.items.filter((part) => part.kind === "truncated")).toHaveLength(0);
  });

  test("a stream surface renders every row, unbounded", () => {
    const state = createToolOutputState({ surface: "stream" });
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", labelKey: "tool.label.file_create" } });
    let update = null;
    for (let i = 1; i <= OUTPUT_WINDOW_ROWS + 5; i++) {
      update = state.push({ toolCallId: "tc_1", content: shellLine(`line-${i}`) });
    }
    expect(update?.items).toHaveLength(OUTPUT_WINDOW_ROWS + 6);
    expect(text(update?.items[1])).toBe("line-1");
  });

  // A create's header states the path and the size; its content follows as its own rows.
  test("a create with no content emitted is its header alone", () => {
    const { state } = setup();
    const update = state.push({
      toolCallId: "tc_1",
      content: { kind: "edit-header", labelKey: "tool.label.file_create", path: "a.ts", added: 214, removed: 0 },
    });
    expect(update?.items).toHaveLength(1);
    expect(update?.label).toBe("Create");
  });
});
