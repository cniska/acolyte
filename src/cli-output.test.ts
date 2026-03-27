import { describe, expect, test } from "bun:test";
import { createJsonOutput, createTextOutput } from "./cli-output";

describe("createTextOutput", () => {
  test("renders row as key=value pairs", () => {
    const out = createTextOutput();
    out.addRow({ event: "lifecycle.start", mode: "work", model: "gpt-5-mini" });
    expect(out.render()).toBe("event=lifecycle.start mode=work model=gpt-5-mini");
  });

  test("omits undefined values in row", () => {
    const out = createTextOutput();
    out.addRow({ event: "lifecycle.tool.call", tool: "file-read", path: undefined });
    expect(out.render()).toBe("event=lifecycle.tool.call tool=file-read");
  });

  test("renders header and rows", () => {
    const out = createTextOutput();
    out.addHeader("task_id=task_1");
    out.addRow({ event: "lifecycle.start", mode: "work" });
    expect(out.render()).toBe("task_id=task_1\nevent=lifecycle.start mode=work");
  });

  test("renders separator as empty line", () => {
    const out = createTextOutput();
    out.addRow({ a: "1" });
    out.addSeparator();
    out.addRow({ b: "2" });
    expect(out.render()).toBe("a=1\n\nb=2");
  });

  test("renders table without headers when no labels provided", () => {
    const out = createTextOutput();
    out.addTable([
      { id: "task_a", model: "gpt-5-mini", status: "ok" },
      { id: "task_bb", model: "gpt-5", status: "error" },
    ]);
    const lines = out.render().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("task_a");
    expect(lines[1]).toContain("task_bb");
  });

  test("renders table with header row when labels provided", () => {
    const out = createTextOutput();
    out.addTable(
      [
        { id: "task_a", model: "gpt-5-mini" },
        { id: "task_bb", model: "gpt-5" },
      ],
      { id: "Task", model: "Model" },
    );
    const lines = out.render().split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("Task");
    expect(lines[0]).toContain("Model");
    expect(lines[1]).toContain("task_a");
  });

  test("renders empty for no content", () => {
    const out = createTextOutput();
    expect(out.render()).toBe("");
  });

  test("verbose defaults to false", () => {
    expect(createTextOutput().verbose).toBe(false);
  });

  test("verbose can be set via options", () => {
    expect(createTextOutput({ verbose: true }).verbose).toBe(true);
  });
});

describe("createJsonOutput", () => {
  test("renders row as JSON", () => {
    const out = createJsonOutput();
    out.addRow({ event: "lifecycle.start", mode: "work" });
    const parsed = JSON.parse(out.render()) as Record<string, string>;
    expect(parsed.event).toBe("lifecycle.start");
    expect(parsed.mode).toBe("work");
  });

  test("strips undefined values", () => {
    const out = createJsonOutput();
    out.addRow({ event: "lifecycle.tool.call", tool: "file-read", path: undefined });
    const parsed = JSON.parse(out.render()) as Record<string, string>;
    expect(parsed.tool).toBe("file-read");
    expect("path" in parsed).toBe(false);
  });

  test("renders table as JSON lines", () => {
    const out = createJsonOutput();
    out.addTable([{ id: "a" }, { id: "b" }]);
    const lines = out.render().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toEqual({ id: "a" });
    expect(JSON.parse(lines[1])).toEqual({ id: "b" });
  });

  test("ignores headers and separators", () => {
    const out = createJsonOutput();
    out.addHeader("should be ignored");
    out.addSeparator();
    out.addRow({ event: "test" });
    const lines = out.render().split("\n");
    expect(lines.length).toBe(1);
  });

  test("renders empty for no content", () => {
    const out = createJsonOutput();
    expect(out.render()).toBe("");
  });
});
