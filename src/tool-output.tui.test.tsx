import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-commands";
import { ChatTranscript } from "./chat-transcript";
import { formatToolOutput, type ToolOutput } from "./tool-output-content";
import { renderInkPlain } from "./tui-test-utils";

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

function renderChat(toolOutput: ToolOutput[]): string {
  const row: ChatRow = { id: "r1", role: "assistant", content: "", style: "toolProgress", toolOutput };
  return renderInkPlain(<ChatTranscript rows={[row]} isWorking={false} thinkingFrame={0} />, 96);
}

describe("tool output TUI — CLI (formatToolOutput)", () => {
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
    const items: ToolOutput[] = [{ kind: "file-header", label: "Read", count: 2, targets: ["a.ts", "b.ts"] }];
    expect(formatToolOutput(items)).toBe("Read a.ts, b.ts");
  });

  test("file-header with omitted targets", () => {
    const items: ToolOutput[] = [
      { kind: "file-header", label: "Read", count: 4, targets: ["a.ts", "b.ts", "c.ts"], omitted: 1 },
    ];
    expect(formatToolOutput(items)).toBe("Read a.ts, b.ts, c.ts, +1");
  });

  test("scope-header with hit rows", () => {
    const items: ToolOutput[] = [
      { kind: "scope-header", label: "Search", scope: "workspace", patterns: ["needle"], matches: 3 },
      { kind: "text", text: "a.ts [needle@1]" },
      { kind: "text", text: "b.ts [needle@2, needle@5]" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Search needle
          a.ts [needle@1]
          b.ts [needle@2, needle@5]
      `),
    );
  });

  test("scope-header with non-workspace scope", () => {
    const items: ToolOutput[] = [
      { kind: "scope-header", label: "Search", scope: "src/", patterns: ["needle"], matches: 1 },
      { kind: "text", text: "a.ts [needle@1]" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Search src/ [needle]
          a.ts [needle@1]
      `),
    );
  });

  test("scope-header for find-files", () => {
    const items: ToolOutput[] = [
      { kind: "scope-header", label: "Find", scope: "workspace", patterns: ["*.ts"], matches: 2 },
      { kind: "text", text: "a.ts" },
      { kind: "text", text: "b.ts" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Find *.ts
          a.ts
          b.ts
      `),
    );
  });

  test("edit-header with diff lines", () => {
    const items: ToolOutput[] = [
      { kind: "edit-header", label: "Edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 9, marker: "context", text: "const x = 1;" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Edit notes.ts (+1 -1)
           9  const x = 1;
          10 -const y = 2;
          10 +const y = 3;
      `),
    );
  });

  test("run-command with text body", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Run", detail: "echo hello" },
      { kind: "command-output", stream: "stdout", text: "hello" },
      { kind: "command-output", stream: "stdout", text: "world" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Run echo hello
          out | hello
          out | world
      `),
    );
  });

  test("run-command with truncated output", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Run", detail: "cmd" },
      { kind: "command-output", stream: "stdout", text: "line1" },
      { kind: "command-output", stream: "stdout", text: "line2" },
      { kind: "truncated", count: 3, unit: "lines" },
      { kind: "command-output", stream: "stdout", text: "line6" },
    ];
    expect(formatToolOutput(items)).toBe(
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
    const items: ToolOutput[] = [{ kind: "tool-header", label: "Run", detail: "cmd" }, { kind: "no-output" }];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Run cmd
          (No output)
      `),
    );
  });

  test("git-status with changes", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Status" },
      { kind: "text", text: "M src/cli.ts" },
      { kind: "text", text: "?? src/new.ts" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Status
          M src/cli.ts
          ?? src/new.ts
      `),
    );
  });

  test("git-diff with text body", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Diff", detail: "src/agent.ts" },
      { kind: "text", text: "diff --git a/src/agent.ts b/src/agent.ts" },
      { kind: "text", text: "+const x = 1;" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Diff src/agent.ts
          diff --git a/src/agent.ts b/src/agent.ts
          +const x = 1;
      `),
    );
  });

  test("git-diff with truncated output", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Diff" },
      { kind: "text", text: "+line1" },
      { kind: "text", text: "-line2" },
      { kind: "truncated", count: 10, unit: "lines" },
      { kind: "text", text: "+line13" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Diff
          +line1
          -line2
          … +10 lines
          +line13
      `),
    );
  });

  test("git-log with commit lines", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Log", detail: "src/cli.ts" },
      { kind: "text", text: "abc1234 feat: add feature" },
      { kind: "text", text: "def5678 fix: resolve bug" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Log src/cli.ts
          abc1234 feat: add feature
          def5678 fix: resolve bug
      `),
    );
  });

  test("git-log with truncated output", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Log" },
      { kind: "text", text: "abc1234 first" },
      { kind: "text", text: "def5678 second" },
      { kind: "truncated", count: 8, unit: "lines" },
      { kind: "text", text: "ghi9012 last" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Log
          abc1234 first
          def5678 second
          … +8 lines
          ghi9012 last
      `),
    );
  });

  test("git-show with ref detail", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Show", detail: "abc1234" },
      { kind: "text", text: "feat: add feature" },
      { kind: "text", text: "+const x = 1;" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Show abc1234
          feat: add feature
          +const x = 1;
      `),
    );
  });

  test("git-add with file paths", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Add", detail: "3 files" },
      { kind: "text", text: "src/a.ts" },
      { kind: "text", text: "src/b.ts" },
      { kind: "text", text: "src/c.ts" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Add 3 files
          src/a.ts
          src/b.ts
          src/c.ts
      `),
    );
  });

  test("git-add with truncated file list", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Add", detail: "8 files" },
      { kind: "text", text: "src/a.ts" },
      { kind: "text", text: "src/b.ts" },
      { kind: "truncated", count: 6, unit: "files" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Add 8 files
          src/a.ts
          src/b.ts
          … +6 files
      `),
    );
  });

  test("git-add all", () => {
    const items: ToolOutput[] = [{ kind: "tool-header", label: "Git Add", detail: "all" }];
    expect(formatToolOutput(items)).toBe("Git Add all");
  });

  test("git-commit with hash", () => {
    const items: ToolOutput[] = [{ kind: "tool-header", label: "Git Commit", detail: "feat: add feature (abc1234)" }];
    expect(formatToolOutput(items)).toBe("Git Commit feat: add feature (abc1234)");
  });

  test("git-commit with body lines", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Commit", detail: "feat: add feature (abc1234)" },
      { kind: "text", text: "Added new auth module" },
      { kind: "text", text: "Updated config schema" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Commit feat: add feature (abc1234)
          Added new auth module
          Updated config schema
      `),
    );
  });

  test("git-commit with truncated body", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Commit", detail: "refactor: cleanup (def5678)" },
      { kind: "text", text: "Line 1" },
      { kind: "text", text: "Line 2" },
      { kind: "truncated", count: 5, unit: "lines" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Git Commit refactor: cleanup (def5678)
          Line 1
          Line 2
          … +5 lines
      `),
    );
  });

  test("truncated without unit", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Find", detail: "*.ts" },
      { kind: "text", text: "a.ts" },
      { kind: "truncated", count: 5, unit: "matches" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Find *.ts
          a.ts
          … +5 matches
      `),
    );
  });
});

describe("tool output TUI — chat (Ink rendering)", () => {
  test("tool-header only", () => {
    expect(renderChat([{ kind: "tool-header", label: "Read", detail: "a.ts" }])).toBe("· Read a.ts");
  });

  test("tool-header without detail", () => {
    expect(renderChat([{ kind: "tool-header", label: "Git Status" }])).toBe("· Git Status");
  });

  test("file-header renders label and targets", () => {
    expect(renderChat([{ kind: "file-header", label: "Read", count: 2, targets: ["a.ts", "b.ts"] }])).toBe(
      "· Read a.ts, b.ts",
    );
  });

  test("scope-header with hit rows", () => {
    const items: ToolOutput[] = [
      { kind: "scope-header", label: "Search", scope: "workspace", patterns: ["needle"], matches: 3 },
      { kind: "text", text: "a.ts [needle@1]" },
      { kind: "text", text: "b.ts [needle@2, needle@5]" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Search needle
            a.ts [needle@1]
            b.ts [needle@2, needle@5]
      `),
    );
  });

  test("edit-header with diff lines", () => {
    const items: ToolOutput[] = [
      { kind: "edit-header", label: "Edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 9, marker: "context", text: "const x = 1;" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Edit notes.ts (+1 -1)
             9 const x = 1;
            10 const y = 2;
            10 const y = 3;
      `),
    );
  });

  test("run-command with stdout", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Run", detail: "echo hello" },
      { kind: "command-output", stream: "stdout", text: "hello" },
      { kind: "command-output", stream: "stdout", text: "world" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Run echo hello
            hello
            world
      `),
    );
  });

  test("run-command with mixed stdout and stderr", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Run", detail: "make" },
      { kind: "command-output", stream: "stdout", text: "compiling..." },
      { kind: "command-output", stream: "stderr", text: "warning: unused var" },
      { kind: "command-output", stream: "stdout", text: "done" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Run make
            compiling...
            warning: unused var
            done
      `),
    );
  });

  test("run-command with truncated output", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Run", detail: "cmd" },
      { kind: "command-output", stream: "stdout", text: "line1" },
      { kind: "command-output", stream: "stdout", text: "line2" },
      { kind: "truncated", count: 3, unit: "lines" },
      { kind: "command-output", stream: "stdout", text: "line6" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Run cmd
            line1
            line2
            … +3 lines
            line6
      `),
    );
  });

  test("no-output marker", () => {
    const items: ToolOutput[] = [{ kind: "tool-header", label: "Run", detail: "cmd" }, { kind: "no-output" }];
    expect(renderChat(items)).toBe(
      dedent(`
        · Run cmd
            (No output)
      `),
    );
  });

  test("git-status with changes", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Status" },
      { kind: "text", text: "M src/cli.ts" },
      { kind: "text", text: "?? src/new.ts" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Git Status
            M src/cli.ts
            ?? src/new.ts
      `),
    );
  });

  test("git-diff with text body", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Diff", detail: "src/agent.ts" },
      { kind: "text", text: "+const x = 1;" },
      { kind: "truncated", count: 5, unit: "lines" },
      { kind: "text", text: "-const y = 2;" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Git Diff src/agent.ts
            +const x = 1;
            … +5 lines
            -const y = 2;
      `),
    );
  });

  test("git-log with commit lines", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Log" },
      { kind: "text", text: "abc1234 feat: add feature" },
      { kind: "text", text: "def5678 fix: resolve bug" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Git Log
            abc1234 feat: add feature
            def5678 fix: resolve bug
      `),
    );
  });

  test("git-show with ref detail", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Show", detail: "abc1234" },
      { kind: "text", text: "feat: add feature" },
      { kind: "text", text: "+const x = 1;" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Git Show abc1234
            feat: add feature
            +const x = 1;
      `),
    );
  });

  test("git-add with file paths", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Add", detail: "3 files" },
      { kind: "text", text: "src/a.ts" },
      { kind: "text", text: "src/b.ts" },
      { kind: "text", text: "src/c.ts" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Git Add 3 files
            src/a.ts
            src/b.ts
            src/c.ts
      `),
    );
  });

  test("git-add with truncated file list", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Add", detail: "8 files" },
      { kind: "text", text: "src/a.ts" },
      { kind: "text", text: "src/b.ts" },
      { kind: "truncated", count: 6, unit: "files" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Git Add 8 files
            src/a.ts
            src/b.ts
            … +6 files
      `),
    );
  });

  test("git-commit with hash", () => {
    expect(renderChat([{ kind: "tool-header", label: "Git Commit", detail: "feat: add feature (abc1234)" }])).toBe(
      "· Git Commit feat: add feature (abc1234)",
    );
  });

  test("git-commit with body lines", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Commit", detail: "feat: add feature (abc1234)" },
      { kind: "text", text: "Added new auth module" },
      { kind: "text", text: "Updated config schema" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Git Commit feat: add feature (abc1234)
            Added new auth module
            Updated config schema
      `),
    );
  });

  test("git-commit with truncated body", () => {
    const items: ToolOutput[] = [
      { kind: "tool-header", label: "Git Commit", detail: "refactor: cleanup (def5678)" },
      { kind: "text", text: "Line 1" },
      { kind: "text", text: "Line 2" },
      { kind: "truncated", count: 5, unit: "lines" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        · Git Commit refactor: cleanup (def5678)
            Line 1
            Line 2
            … +5 lines
      `),
    );
  });
});
