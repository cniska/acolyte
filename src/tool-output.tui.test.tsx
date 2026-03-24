import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { ChatTranscript } from "./chat-transcript";
import { dedent } from "./test-utils";
import { formatToolOutput, type ToolOutputPart } from "./tool-output-content";
import { renderPlain } from "./tui-test-utils";

function renderChat(toolOutput: ToolOutputPart[]): string {
  const row: ChatRow = { id: "r1", kind: "tool", content: { parts: toolOutput } };
  return renderPlain(<ChatTranscript rows={[row]} pendingFrame={0} />, 96);
}

describe("tool output TUI — CLI (formatToolOutput)", () => {
  test("empty content returns empty string", () => {
    expect(formatToolOutput([])).toBe("");
  });

  test("tool-header only", () => {
    expect(formatToolOutput([{ kind: "tool-header", labelKey: "tool.label.read", detail: "a.ts" }])).toBe("Read a.ts");
  });

  test("tool-header without detail", () => {
    expect(formatToolOutput([{ kind: "tool-header", labelKey: "tool.label.git_status" }])).toBe("Git Status");
  });

  test("file-header renders label and targets", () => {
    const items: ToolOutputPart[] = [
      { kind: "file-header", labelKey: "tool.label.read", count: 2, targets: ["a.ts", "b.ts"] },
    ];
    expect(formatToolOutput(items)).toBe("Read a.ts, b.ts");
  });

  test("file-header with omitted targets", () => {
    const items: ToolOutputPart[] = [
      { kind: "file-header", labelKey: "tool.label.read", count: 4, targets: ["a.ts", "b.ts", "c.ts"], omitted: 1 },
    ];
    expect(formatToolOutput(items)).toBe("Read a.ts, b.ts, c.ts, +1");
  });

  test("scope-header with hit rows", () => {
    const items: ToolOutputPart[] = [
      { kind: "scope-header", labelKey: "tool.label.search", scope: "workspace", patterns: ["needle"], matches: 3 },
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
    const items: ToolOutputPart[] = [
      { kind: "scope-header", labelKey: "tool.label.search", scope: "src/", patterns: ["needle"], matches: 1 },
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
    const items: ToolOutputPart[] = [
      { kind: "scope-header", labelKey: "tool.label.find", scope: "workspace", patterns: ["*.ts"], matches: 2 },
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
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.run", detail: "echo hello" },
      { kind: "shell-output", stream: "stdout", text: "hello" },
      { kind: "shell-output", stream: "stdout", text: "world" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.run", detail: "cmd" },
      { kind: "shell-output", stream: "stdout", text: "line1" },
      { kind: "shell-output", stream: "stdout", text: "line2" },
      { kind: "truncated", count: 3, unit: "lines" },
      { kind: "shell-output", stream: "stdout", text: "line6" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.run", detail: "cmd" },
      { kind: "no-output" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Run cmd
          (No output)
      `),
    );
  });

  test("git-status with changes", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_status" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_diff", detail: "src/agent.ts" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_diff" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_log", detail: "src/cli.ts" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_log" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_show", detail: "abc1234" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_add", detail: "3 files" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_add", detail: "8 files" },
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
    const items: ToolOutputPart[] = [{ kind: "tool-header", labelKey: "tool.label.git_add", detail: "all" }];
    expect(formatToolOutput(items)).toBe("Git Add all");
  });

  test("git-commit with hash", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "feat: add feature (abc1234)" },
    ];
    expect(formatToolOutput(items)).toBe("Git Commit feat: add feature (abc1234)");
  });

  test("git-commit with body lines", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "feat: add feature (abc1234)" },
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
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "refactor: cleanup (def5678)" },
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

  test("diff context gaps show ellipsis without line count", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 1, marker: "context", text: "const a = 1;" },
      { kind: "truncated" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
      { kind: "diff", lineNumber: 11, marker: "context", text: "const b = 4;" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Edit notes.ts (+1 -1)
           1  const a = 1;
           …
          10 -const y = 2;
          10 +const y = 3;
          11  const b = 4;
      `),
    );
  });

  test("multi-file edit-header with per-file sub-headers", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.edit", path: "14 files", files: 14, added: 28, removed: 28 },
      { kind: "text", text: "src/short-id.ts (+1 -1)" },
      { kind: "diff", lineNumber: 2, marker: "remove", text: "export function generateId(size = 8): string {" },
      { kind: "diff", lineNumber: 2, marker: "add", text: "export function generateId(size = 8): string {" },
      { kind: "text", text: "src/chat-contract.ts (+2 -2)" },
      { kind: "diff", lineNumber: 4, marker: "remove", text: 'import { generateId } from "./short-id";' },
      { kind: "diff", lineNumber: 4, marker: "add", text: 'import { generateId } from "./short-id";' },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Edit 14 files (+28 -28)
          src/short-id.ts (+1 -1)
            2 -export function generateId(size = 8): string {
            2 +export function generateId(size = 8): string {
          src/chat-contract.ts (+2 -2)
            4 -import { generateId } from "./short-id";
            4 +import { generateId } from "./short-id";
      `),
    );
  });

  test("single-file edit has no per-file sub-header", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 2, marker: "remove", text: "old" },
      { kind: "diff", lineNumber: 2, marker: "add", text: "new" },
    ];
    expect(formatToolOutput(items)).toBe(
      dedent(`
        Edit notes.ts (+1 -1)
          2 -old
          2 +new
      `),
    );
  });

  test("truncated without unit", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.find", detail: "*.ts" },
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
    expect(renderChat([{ kind: "tool-header", labelKey: "tool.label.read", detail: "a.ts" }])).toBe("• Read a.ts");
  });

  test("tool-header without detail", () => {
    expect(renderChat([{ kind: "tool-header", labelKey: "tool.label.git_status" }])).toBe("• Git Status");
  });

  test("file-header renders label and targets", () => {
    expect(
      renderChat([{ kind: "file-header", labelKey: "tool.label.read", count: 2, targets: ["a.ts", "b.ts"] }]),
    ).toBe("• Read a.ts, b.ts");
  });

  test("scope-header with hit rows", () => {
    const items: ToolOutputPart[] = [
      { kind: "scope-header", labelKey: "tool.label.search", scope: "workspace", patterns: ["needle"], matches: 3 },
      { kind: "text", text: "a.ts [needle@1]" },
      { kind: "text", text: "b.ts [needle@2, needle@5]" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Search needle
            a.ts [needle@1]
            b.ts [needle@2, needle@5]
      `),
    );
  });

  test("edit-header with diff lines", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 9, marker: "context", text: "const x = 1;" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Edit notes.ts (+1 -1)
              9  const x = 1;
             10 -const y = 2;
             10 +const y = 3;
      `),
    );
  });

  test("run-command with stdout", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.run", detail: "echo hello" },
      { kind: "shell-output", stream: "stdout", text: "hello" },
      { kind: "shell-output", stream: "stdout", text: "world" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Run echo hello
            hello
            world
      `),
    );
  });

  test("run-command with mixed stdout and stderr", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.run", detail: "make" },
      { kind: "shell-output", stream: "stdout", text: "compiling..." },
      { kind: "shell-output", stream: "stderr", text: "warning: unused var" },
      { kind: "shell-output", stream: "stdout", text: "done" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Run make
            compiling...
            warning: unused var
            done
      `),
    );
  });

  test("run-command with truncated output", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.run", detail: "cmd" },
      { kind: "shell-output", stream: "stdout", text: "line1" },
      { kind: "shell-output", stream: "stdout", text: "line2" },
      { kind: "truncated", count: 3, unit: "lines" },
      { kind: "shell-output", stream: "stdout", text: "line6" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Run cmd
            line1
            line2
            … +3 lines
            line6
      `),
    );
  });

  test("no-output marker", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.run", detail: "cmd" },
      { kind: "no-output" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Run cmd
            (No output)
      `),
    );
  });

  test("git-status with changes", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_status" },
      { kind: "text", text: "M src/cli.ts" },
      { kind: "text", text: "?? src/new.ts" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Status
            M src/cli.ts
            ?? src/new.ts
      `),
    );
  });

  test("git-diff with text body", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_diff", detail: "src/agent.ts" },
      { kind: "text", text: "+const x = 1;" },
      { kind: "truncated", count: 5, unit: "lines" },
      { kind: "text", text: "-const y = 2;" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Diff src/agent.ts
            +const x = 1;
            … +5 lines
            -const y = 2;
      `),
    );
  });

  test("git-log with commit lines", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_log" },
      { kind: "text", text: "abc1234 feat: add feature" },
      { kind: "text", text: "def5678 fix: resolve bug" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Log
            abc1234 feat: add feature
            def5678 fix: resolve bug
      `),
    );
  });

  test("git-show with ref detail", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_show", detail: "abc1234" },
      { kind: "text", text: "feat: add feature" },
      { kind: "text", text: "+const x = 1;" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Show abc1234
            feat: add feature
            +const x = 1;
      `),
    );
  });

  test("git-add with file paths", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_add", detail: "3 files" },
      { kind: "text", text: "src/a.ts" },
      { kind: "text", text: "src/b.ts" },
      { kind: "text", text: "src/c.ts" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Add 3 files
            src/a.ts
            src/b.ts
            src/c.ts
      `),
    );
  });

  test("git-add with truncated file list", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_add", detail: "8 files" },
      { kind: "text", text: "src/a.ts" },
      { kind: "text", text: "src/b.ts" },
      { kind: "truncated", count: 6, unit: "files" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Add 8 files
            src/a.ts
            src/b.ts
            … +6 files
      `),
    );
  });

  test("git-commit with hash", () => {
    expect(
      renderChat([{ kind: "tool-header", labelKey: "tool.label.git_commit", detail: "feat: add feature (abc1234)" }]),
    ).toBe("• Git Commit feat: add feature (abc1234)");
  });

  test("git-commit with body lines", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "feat: add feature (abc1234)" },
      { kind: "text", text: "Added new auth module" },
      { kind: "text", text: "Updated config schema" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Commit feat: add feature (abc1234)
            Added new auth module
            Updated config schema
      `),
    );
  });

  test("git-commit with truncated body", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "refactor: cleanup (def5678)" },
      { kind: "text", text: "Line 1" },
      { kind: "text", text: "Line 2" },
      { kind: "truncated", count: 5, unit: "lines" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Commit refactor: cleanup (def5678)
            Line 1
            Line 2
            … +5 lines
      `),
    );
  });
});
