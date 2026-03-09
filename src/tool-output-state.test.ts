import { describe, expect, test } from "bun:test";
import { dedent } from "./test-utils";
import { createToolOutputState, type ToolOutput } from "./tool-output-content";

function setup() {
  const state = createToolOutputState();
  const push = (content: ToolOutput, toolCallId = "tc_1") => state.push({ toolCallId, content });
  return { state, push };
}

describe("createToolOutputState", () => {
  test("bare tool-header renders label only", () => {
    const { push } = setup();
    const update = push({ kind: "tool-header", label: "Find" });
    expect(update?.rendered).toBe("Find");
    expect(update?.label).toBe("Find");
  });

  test("tool-header with detail renders immediately", () => {
    const { push } = setup();
    const update = push({ kind: "tool-header", label: "Run", detail: "echo hello" });
    expect(update?.rendered).toBe("Run echo hello");
  });

  test("scope-header renders label and patterns", () => {
    const { push } = setup();
    const update = push({ kind: "scope-header", label: "Find", scope: "workspace", patterns: ["*.ts"], matches: 2 });
    expect(update?.rendered).toBe("Find *.ts");
    expect(update?.label).toBe("Find");
  });

  test("file-header renders label and targets", () => {
    const { push } = setup();
    const update = push({ kind: "file-header", label: "Read", count: 1, targets: ["a.ts"] });
    expect(update?.rendered).toBe("Read a.ts");
    expect(update?.label).toBe("Read");
  });

  test("edit-header renders label path and stats", () => {
    const { push } = setup();
    const update = push({ kind: "edit-header", label: "Edit", path: "notes.ts", files: 1, added: 1, removed: 1 });
    expect(update?.rendered).toBe("Edit notes.ts (+1 -1)");
    expect(update?.label).toBe("Edit");
  });

  test("appends body lines after header with indent", () => {
    const { push } = setup();
    push({ kind: "scope-header", label: "Find", scope: "workspace", patterns: ["*.ts"], matches: 2 });
    push({ kind: "text", text: "a.ts" });
    const update = push({ kind: "text", text: "b.ts" });
    expect(update?.rendered).toBe(
      dedent(`
        Find *.ts
          a.ts
          b.ts
      `),
    );
  });

  test("deduplicates identical consecutive items", () => {
    const { push } = setup();
    push({ kind: "tool-header", label: "Run", detail: "cmd" });
    push({ kind: "text", text: "out | a" });
    const update = push({ kind: "text", text: "out | a" });
    expect(update).toBeNull();
  });

  test("includes no-output marker", () => {
    const { push } = setup();
    push({ kind: "tool-header", label: "Run", detail: "cmd" });
    const update = push({ kind: "no-output" });
    expect(update?.rendered).toBe(
      dedent(`
        Run cmd
          (No output)
      `),
    );
  });

  test("includes truncated marker", () => {
    const { push } = setup();
    push({ kind: "tool-header", label: "Run", detail: "cmd" });
    push({ kind: "text", text: "line1" });
    push({ kind: "truncated", count: 8, unit: "lines" });
    const update = push({ kind: "text", text: "line10" });
    expect(update?.rendered).toBe(
      dedent(`
        Run cmd
          line1
          … +8 lines
          line10
      `),
    );
  });

  test("tracks independent tool calls", () => {
    const { state } = setup();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", label: "Run", detail: "cmd1" } });
    state.push({ toolCallId: "tc_2", content: { kind: "tool-header", label: "Run", detail: "cmd2" } });
    const u1 = state.push({ toolCallId: "tc_1", content: { kind: "text", text: "a" } });
    const u2 = state.push({ toolCallId: "tc_2", content: { kind: "text", text: "b" } });
    expect(u1?.rendered).toBe("Run cmd1\n  a");
    expect(u2?.rendered).toBe("Run cmd2\n  b");
  });

  test("delete removes state for a tool call", () => {
    const { state } = setup();
    state.push({ toolCallId: "tc_1", content: { kind: "tool-header", label: "Run", detail: "cmd" } });
    state.delete("tc_1");
    const update = state.push({ toolCallId: "tc_1", content: { kind: "tool-header", label: "Run", detail: "cmd2" } });
    expect(update?.rendered).toBe("Run cmd2");
  });
});
