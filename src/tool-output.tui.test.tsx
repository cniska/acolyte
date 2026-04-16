import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { ChatTranscript } from "./chat-transcript";
import { dedent } from "./test-utils";
import type { ToolOutputPart } from "./tool-output-contract";
import { renderToolOutput } from "./tool-output-render";
import { renderPlain } from "./tui/test-utils";

function renderChat(toolOutput: ToolOutputPart[]): string {
  const row: ChatRow = { id: "r1", kind: "tool", content: { parts: toolOutput } };
  return renderPlain(<ChatTranscript rows={[row]} pendingFrame={0} />, 96);
}

describe("tool output TUI — CLI (renderToolOutput)", () => {
  test("empty content returns empty string", () => {
    expect(renderToolOutput([])).toBe("");
  });

  test("tool-header only", () => {
    expect(renderToolOutput([{ kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" }])).toBe(
      "Read a.ts",
    );
  });

  test("tool-header without detail", () => {
    expect(renderToolOutput([{ kind: "tool-header", labelKey: "tool.label.git_status" }])).toBe("Git Status");
  });

  test("file-header renders label and targets", () => {
    const items: ToolOutputPart[] = [
      { kind: "file-header", labelKey: "tool.label.file_read", count: 2, targets: ["a.ts", "b.ts"] },
    ];
    expect(renderToolOutput(items)).toBe("Read 2 files");
  });

  test("file-header with single file shows path", () => {
    const items: ToolOutputPart[] = [
      { kind: "file-header", labelKey: "tool.label.file_read", count: 1, targets: ["a.ts"] },
    ];
    expect(renderToolOutput(items)).toBe("Read a.ts");
  });

  test("scope-header for search with summary", () => {
    const items: ToolOutputPart[] = [
      {
        kind: "scope-header",
        labelKey: "tool.label.file_search",
        scope: "workspace",
        patterns: ["needle"],
        matches: 3,
      },
      { kind: "text", text: "3 matches in 2 files" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Search needle
          3 matches in 2 files
      `),
    );
  });

  test("scope-header with non-workspace scope", () => {
    const items: ToolOutputPart[] = [
      { kind: "scope-header", labelKey: "tool.label.file_search", scope: "src/", patterns: ["needle"], matches: 1 },
      { kind: "text", text: "1 match in 1 file" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Search needle in src/
          1 match in 1 file
      `),
    );
  });

  test("scope-header for file-find", () => {
    const items: ToolOutputPart[] = [
      { kind: "scope-header", labelKey: "tool.label.file_find", scope: "workspace", patterns: ["*.ts"], matches: 2 },
      { kind: "text", text: "2 files" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Find *.ts
          2 files
      `),
    );
  });

  test("scope-header with multiple patterns shows count", () => {
    const items: ToolOutputPart[] = [
      {
        kind: "scope-header",
        labelKey: "tool.label.file_search",
        scope: "workspace",
        patterns: ["foo", "bar", "baz"],
        matches: 5,
      },
      { kind: "text", text: "5 matches in 3 files" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Search 3 patterns
          5 matches in 3 files
      `),
    );
  });

  test("edit-header with diff lines", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 9, marker: "context", text: "const x = 1;" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Edit notes.ts (+1 -1)
           9  const x = 1;
          10 -const y = 2;
          10 +const y = 3;
      `),
    );
  });

  test("shell-run with text body", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "echo hello" },
      { kind: "shell-output", stream: "stdout", text: "hello" },
      { kind: "shell-output", stream: "stdout", text: "world" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Run echo hello
          out | hello
          out | world
      `),
    );
  });

  test("shell-run with truncated output", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" },
      { kind: "shell-output", stream: "stdout", text: "line1" },
      { kind: "shell-output", stream: "stdout", text: "line2" },
      { kind: "text", text: "⋮ +3 lines" },
      { kind: "shell-output", stream: "stdout", text: "line6" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Run cmd
          out | line1
          out | line2
          ⋮ +3 lines
          out | line6
      `),
    );
  });

  test("no-output marker", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" },
      { kind: "no-output" },
    ];
    expect(renderToolOutput(items)).toBe(
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
    expect(renderToolOutput(items)).toBe(
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
    expect(renderToolOutput(items)).toBe(
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
      { kind: "text", text: "⋮ +10 lines" },
      { kind: "text", text: "+line13" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Git Diff
          +line1
          -line2
          ⋮ +10 lines
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
    expect(renderToolOutput(items)).toBe(
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
    expect(renderToolOutput(items)).toBe(
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
    expect(renderToolOutput(items)).toBe(
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
    expect(renderToolOutput(items)).toBe(
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
    expect(renderToolOutput(items)).toBe(
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
    expect(renderToolOutput(items)).toBe("Git Add all");
  });

  test("git-commit with hash", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "feat: add feature (abc1234)" },
    ];
    expect(renderToolOutput(items)).toBe("Git Commit feat: add feature (abc1234)");
  });

  test("git-commit with body lines", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "feat: add feature (abc1234)" },
      { kind: "text", text: "Added new auth module" },
      { kind: "text", text: "Updated config schema" },
    ];
    expect(renderToolOutput(items)).toBe(
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
    expect(renderToolOutput(items)).toBe(
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
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 1, marker: "context", text: "const a = 1;" },
      { kind: "truncated" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
      { kind: "diff", lineNumber: 11, marker: "context", text: "const b = 4;" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Edit notes.ts (+1 -1)
           1  const a = 1;
           ⋮
          10 -const y = 2;
          10 +const y = 3;
          11  const b = 4;
      `),
    );
  });

  test("multi-file edit-header with per-file sub-headers", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "14 files", files: 14, added: 28, removed: 28 },
      { kind: "text", text: "src/short-id.ts (+1 -1)" },
      { kind: "diff", lineNumber: 2, marker: "remove", text: "export function generateId(size = 8): string {" },
      { kind: "diff", lineNumber: 2, marker: "add", text: "export function generateId(size = 8): string {" },
      { kind: "text", text: "src/chat-contract.ts (+2 -2)" },
      { kind: "diff", lineNumber: 4, marker: "remove", text: 'import { generateId } from "./short-id";' },
      { kind: "diff", lineNumber: 4, marker: "add", text: 'import { generateId } from "./short-id";' },
    ];
    expect(renderToolOutput(items)).toBe(
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
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
      { kind: "diff", lineNumber: 2, marker: "remove", text: "old" },
      { kind: "diff", lineNumber: 2, marker: "add", text: "new" },
    ];
    expect(renderToolOutput(items)).toBe(
      dedent(`
        Edit notes.ts (+1 -1)
          2 -old
          2 +new
      `),
    );
  });

  test("skill-activate with name", () => {
    expect(renderToolOutput([{ kind: "tool-header", labelKey: "tool.label.skill", detail: "build" }])).toBe(
      "Skill build",
    );
  });

  test("truncated without unit", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.file_find", detail: "*.ts" },
      { kind: "text", text: "a.ts" },
      { kind: "truncated", count: 5, unit: "matches" },
    ];
    expect(renderToolOutput(items)).toBe(
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
    expect(renderChat([{ kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" }])).toBe("• Read a.ts");
  });

  test("tool-header without detail", () => {
    expect(renderChat([{ kind: "tool-header", labelKey: "tool.label.git_status" }])).toBe("• Git Status");
  });

  test("file-header renders label and targets", () => {
    expect(
      renderChat([{ kind: "file-header", labelKey: "tool.label.file_read", count: 2, targets: ["a.ts", "b.ts"] }]),
    ).toBe("• Read 2 files");
  });

  test("scope-header with summary", () => {
    const items: ToolOutputPart[] = [
      {
        kind: "scope-header",
        labelKey: "tool.label.file_search",
        scope: "workspace",
        patterns: ["needle"],
        matches: 3,
      },
      { kind: "text", text: "3 matches in 2 files" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Search needle
            3 matches in 2 files
      `),
    );
  });

  test("edit-header with diff lines", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", files: 1, added: 1, removed: 1 },
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

  test("shell-run with stdout", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "echo hello" },
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

  test("shell-run with mixed stdout and stderr", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "make" },
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

  test("shell-run with truncated output", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" },
      { kind: "shell-output", stream: "stdout", text: "line1" },
      { kind: "shell-output", stream: "stdout", text: "line2" },
      { kind: "text", text: "⋮ +3 lines" },
      { kind: "shell-output", stream: "stdout", text: "line6" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Run cmd
            line1
            line2
            ⋮ +3 lines
            line6
      `),
    );
  });

  test("no-output marker", () => {
    const items: ToolOutputPart[] = [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" },
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
      { kind: "text", text: "⋮ +5 lines" },
      { kind: "text", text: "-const y = 2;" },
    ];
    expect(renderChat(items)).toBe(
      dedent(`
        • Git Diff src/agent.ts
            +const x = 1;
            ⋮ +5 lines
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

  test("skill-activate with name", () => {
    expect(renderChat([{ kind: "tool-header", labelKey: "tool.label.skill", detail: "build" }])).toBe("• Skill build");
  });
});
