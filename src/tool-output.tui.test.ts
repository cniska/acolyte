import { describe, expect, test } from "bun:test";
import { formatToolOutput } from "./cli-format";
import type { ToolOutput } from "./tool-output-content";

function dedent(value: string): string {
  const lines = value.split("\n");
  let start = 0;
  while (start < lines.length && lines[start]?.trim().length === 0) start += 1;
  let end = lines.length - 1;
  while (end >= start && lines[end]?.trim().length === 0) end -= 1;
  if (start > end) return "";
  let prefix: string | null = null;
  for (const line of lines.slice(start, end + 1)) {
    if (line.trim().length === 0) continue;
    const current = line.match(/^[ \t]*/)?.[0] ?? "";
    if (prefix === null || current.length < prefix.length) prefix = current;
  }
  const p = prefix ?? "";
  return lines
    .slice(start, end + 1)
    .map((line) => (line.startsWith(p) ? line.slice(p.length) : line))
    .join("\n");
}

const stripAnsi = (value: string): string => {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "\u001b" && value[i + 1] === "[") {
      i += 2;
      while (i < value.length && value[i] !== "m") i += 1;
      continue;
    }
    if (ch != null) out += ch;
  }
  return out;
};

describe("tool output TUI", () => {
  test("empty content returns empty string", () => {
    expect(formatToolOutput([])).toBe("");
  });

  test("tool-header only", () => {
    expect(formatToolOutput([{ kind: "tool-header", label: "Read", detail: "a.ts" }])).toBe("Read a.ts");
  });

  test("tool-header without detail", () => {
    expect(formatToolOutput([{ kind: "tool-header", label: "Git Status" }])).toBe("Git Status");
  });

  test("file-header renders label and targets", () => {
    const content: ToolOutput[] = [{ kind: "file-header", label: "Read", count: 2, targets: ["a.ts", "b.ts"] }];
    expect(formatToolOutput(content)).toBe("Read a.ts, b.ts");
  });

  test("file-header with omitted targets", () => {
    const content: ToolOutput[] = [
      { kind: "file-header", label: "Read", count: 4, targets: ["a.ts", "b.ts", "c.ts"], omitted: 1 },
    ];
    expect(formatToolOutput(content)).toBe("Read a.ts, b.ts, c.ts, +1");
  });

  test("scope-header with hit rows", () => {
    const content: ToolOutput[] = [
      { kind: "scope-header", label: "Search", scope: "workspace", patterns: ["needle"], matches: 3 },
      { kind: "text", text: "a.ts [needle@1]" },
      { kind: "text", text: "b.ts [needle@2, needle@5]" },
    ];
    expect(formatToolOutput(content)).toBe(
      dedent(`
        Search needle
          a.ts [needle@1]
          b.ts [needle@2, needle@5]
      `),
    );
  });

  test("scope-header with non-workspace scope", () => {
    const content: ToolOutput[] = [
      { kind: "scope-header", label: "Search", scope: "src/", patterns: ["needle"], matches: 1 },
      { kind: "text", text: "a.ts [needle@1]" },
    ];
    expect(formatToolOutput(content)).toBe(
      dedent(`
        Search src/ [needle]
          a.ts [needle@1]
      `),
    );
  });

  test("scope-header for find-files", () => {
    const content: ToolOutput[] = [
      { kind: "scope-header", label: "Find", scope: "workspace", patterns: ["*.ts"], matches: 2 },
      { kind: "text", text: "a.ts" },
      { kind: "text", text: "b.ts" },
    ];
    expect(formatToolOutput(content)).toBe(
      dedent(`
        Find *.ts
          a.ts
          b.ts
      `),
    );
  });

  test("edit-header with diff lines", () => {
    const content: ToolOutput[] = [
      { kind: "edit-header", label: "Edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 9, marker: "context", text: "const x = 1;" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
    ];
    expect(stripAnsi(formatToolOutput(content))).toBe(
      dedent(`
        Edit notes.ts (+1 -1)
           9  const x = 1;
          10  const y = 2;
          10  const y = 3;
      `),
    );
  });

  test("run-command with text body", () => {
    const content: ToolOutput[] = [
      { kind: "tool-header", label: "Run", detail: "echo hello" },
      { kind: "text", text: "out | hello" },
      { kind: "text", text: "out | world" },
    ];
    expect(formatToolOutput(content)).toBe(
      dedent(`
        Run echo hello
          out | hello
          out | world
      `),
    );
  });

  test("run-command with truncated output", () => {
    const content: ToolOutput[] = [
      { kind: "tool-header", label: "Run", detail: "cmd" },
      { kind: "text", text: "out | line1" },
      { kind: "text", text: "out | line2" },
      { kind: "truncated", count: 3, unit: "lines" },
      { kind: "text", text: "out | line6" },
    ];
    expect(formatToolOutput(content)).toBe(
      dedent(`
        Run cmd
          out | line1
          out | line2
          … +3 lines
          out | line6
      `),
    );
  });

  test("no-output marker", () => {
    const content: ToolOutput[] = [{ kind: "tool-header", label: "Run", detail: "cmd" }, { kind: "no-output" }];
    expect(formatToolOutput(content)).toBe(
      dedent(`
        Run cmd
          (No output)
      `),
    );
  });

  test("git-diff with text body", () => {
    const content: ToolOutput[] = [
      { kind: "tool-header", label: "Git Diff", detail: "src/agent.ts" },
      { kind: "text", text: "diff --git a/src/agent.ts b/src/agent.ts" },
      { kind: "text", text: "+const x = 1;" },
    ];
    expect(formatToolOutput(content)).toBe(
      dedent(`
        Git Diff src/agent.ts
          diff --git a/src/agent.ts b/src/agent.ts
          +const x = 1;
      `),
    );
  });

  test("truncated without unit", () => {
    const content: ToolOutput[] = [
      { kind: "tool-header", label: "Find", detail: "*.ts" },
      { kind: "text", text: "a.ts" },
      { kind: "truncated", count: 5, unit: "matches" },
    ];
    expect(formatToolOutput(content)).toBe(
      dedent(`
        Find *.ts
          a.ts
          … +5 matches
      `),
    );
  });
});
