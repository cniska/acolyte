import { describe, expect, test } from "bun:test";
import { palette } from "./palette";
import { layoutTranscriptTool } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { dedent } from "./test-utils";
import type { ToolOutputPart } from "./tool-output-contract";
import { renderToolOutput } from "./tool-output-render";
import { renderToString } from "./tui/index";
import { ansi, colorToFg } from "./tui/styles";
import { renderPlain } from "./tui/test-utils";

function renderChat(toolOutput: ToolOutputPart[], columns = 96): string {
  const scene = layoutTranscriptTool({ parts: toolOutput, status: "complete", columns });
  return renderPlain(<TerminalSceneRender scene={scene} />, columns);
}

/**
 * One case, two expected strings. The CLI (`renderToolOutput`) and chat
 * (`layoutTranscriptTool` scene) blocks are two serializers over the same shared layout
 * (`tool-output-layout.ts`); they diverge only where intended — the CLI is
 * markerless and keeps `out |`/`err |` stream prefixes, chat prepends the row
 * marker glyph and colors the diff band. This shared table drives both from one input
 * so a case can never be present in one block and silently missing from the
 * other; a new case that omits `cli` or `chat` is a type error, not a gap.
 */
interface ToolCase {
  name: string;
  parts: ToolOutputPart[];
  cli: string;
  chat: string;
}

const CASES: ToolCase[] = [
  {
    name: "tool-header with detail",
    parts: [{ kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" }],
    cli: "Read a.ts",
    chat: "◆ Read a.ts",
  },
  {
    name: "tool-header without detail",
    parts: [{ kind: "tool-header", labelKey: "tool.label.git_status" }],
    cli: "Git Status",
    chat: "◆ Git Status",
  },
  {
    name: "file-header renders label and targets",
    parts: [{ kind: "file-header", labelKey: "tool.label.file_read", count: 2, targets: ["a.ts", "b.ts"] }],
    cli: "Read 2 files",
    chat: "◆ Read 2 files",
  },
  {
    name: "file-header with single file shows path",
    parts: [{ kind: "file-header", labelKey: "tool.label.file_read", count: 1, targets: ["a.ts"] }],
    cli: "Read a.ts",
    chat: "◆ Read a.ts",
  },
  {
    name: "scope-header for search with summary",
    parts: [
      {
        kind: "scope-header",
        labelKey: "tool.label.file_search",
        scope: "workspace",
        patterns: ["needle"],
        matches: 3,
      },
      { kind: "text", text: "3 matches in 2 files" },
    ],
    cli: dedent(`
      Search needle
        3 matches in 2 files
    `),
    chat: dedent(`
      ◆ Search needle
          3 matches in 2 files
    `),
  },
  {
    name: "scope-header with non-workspace scope",
    parts: [
      { kind: "scope-header", labelKey: "tool.label.file_search", scope: "src/", patterns: ["needle"], matches: 1 },
      { kind: "text", text: "1 match in 1 file" },
    ],
    cli: dedent(`
      Search needle in src/
        1 match in 1 file
    `),
    chat: dedent(`
      ◆ Search needle in src/
          1 match in 1 file
    `),
  },
  {
    name: "scope-header for file-find",
    parts: [
      { kind: "scope-header", labelKey: "tool.label.file_find", scope: "workspace", patterns: ["*.ts"], matches: 2 },
      { kind: "text", text: "2 files" },
    ],
    cli: dedent(`
      Find *.ts
        2 files
    `),
    chat: dedent(`
      ◆ Find *.ts
          2 files
    `),
  },
  {
    name: "scope-header with multiple patterns shows count",
    parts: [
      {
        kind: "scope-header",
        labelKey: "tool.label.file_search",
        scope: "workspace",
        patterns: ["foo", "bar", "baz"],
        matches: 5,
      },
      { kind: "text", text: "5 matches in 3 files" },
    ],
    cli: dedent(`
      Search 3 patterns
        5 matches in 3 files
    `),
    chat: dedent(`
      ◆ Search 3 patterns
          5 matches in 3 files
    `),
  },
  {
    name: "edit-header with diff lines",
    parts: [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", added: 1, removed: 1 },
      { kind: "diff", lineNumber: 9, marker: "context", text: "const x = 1;" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
    ],
    cli: dedent(`
      Edit notes.ts (+1 -1)
          9  const x = 1;
         10 -const y = 2;
         10 +const y = 3;
    `),
    chat: dedent(`
      ◆ Edit notes.ts (+1 -1)
            9  const x = 1;
           10 -const y = 2;
           10 +const y = 3;
    `),
  },
  {
    name: "diff context gaps show ellipsis without line count",
    parts: [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", added: 1, removed: 1 },
      { kind: "diff", lineNumber: 1, marker: "context", text: "const a = 1;" },
      { kind: "truncated" },
      { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
      { kind: "diff", lineNumber: 11, marker: "context", text: "const b = 4;" },
    ],
    cli: dedent(`
      Edit notes.ts (+1 -1)
          1  const a = 1;
          ⋮
         10 -const y = 2;
         10 +const y = 3;
         11  const b = 4;
    `),
    chat: dedent(`
      ◆ Edit notes.ts (+1 -1)
            1  const a = 1;
            ⋮
           10 -const y = 2;
           10 +const y = 3;
           11  const b = 4;
    `),
  },
  {
    name: "diff gap with a line count shows the count beside the ellipsis",
    parts: [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", added: 1, removed: 1 },
      { kind: "diff", lineNumber: 1, marker: "context", text: "const a = 1;" },
      { kind: "truncated", count: 3, unit: "lines" },
      { kind: "diff", lineNumber: 10, marker: "add", text: "const y = 3;" },
    ],
    cli: dedent(`
      Edit notes.ts (+1 -1)
          1  const a = 1;
          ⋮  +3 lines
         10 +const y = 3;
    `),
    chat: dedent(`
      ◆ Edit notes.ts (+1 -1)
            1  const a = 1;
            ⋮  +3 lines
           10 +const y = 3;
    `),
  },
  {
    name: "single-file edit has no per-file sub-header",
    parts: [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", added: 1, removed: 1 },
      { kind: "diff", lineNumber: 2, marker: "remove", text: "old" },
      { kind: "diff", lineNumber: 2, marker: "add", text: "new" },
    ],
    cli: dedent(`
      Edit notes.ts (+1 -1)
         2 -old
         2 +new
    `),
    chat: dedent(`
      ◆ Edit notes.ts (+1 -1)
           2 -old
           2 +new
    `),
  },
  {
    name: "shell-run with text body",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "echo hello" },
      { kind: "shell-output", stream: "stdout", text: "hello" },
      { kind: "shell-output", stream: "stdout", text: "world" },
    ],
    cli: dedent(`
      Run echo hello
        out | hello
        out | world
    `),
    chat: dedent(`
      ◆ Run echo hello
          hello
          world
    `),
  },
  {
    name: "shell-run with mixed stdout and stderr",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "make" },
      { kind: "shell-output", stream: "stdout", text: "compiling..." },
      { kind: "shell-output", stream: "stderr", text: "warning: unused var" },
      { kind: "shell-output", stream: "stdout", text: "done" },
    ],
    cli: dedent(`
      Run make
        out | compiling...
        err | warning: unused var
        out | done
    `),
    chat: dedent(`
      ◆ Run make
          compiling...
          warning: unused var
          done
    `),
  },
  {
    name: "shell-run with truncated output",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" },
      { kind: "shell-output", stream: "stdout", text: "line1" },
      { kind: "shell-output", stream: "stdout", text: "line2" },
      { kind: "text", text: "⋮ +3 lines" },
      { kind: "shell-output", stream: "stdout", text: "line6" },
    ],
    cli: dedent(`
      Run cmd
        out | line1
        out | line2
        ⋮ +3 lines
        out | line6
    `),
    chat: dedent(`
      ◆ Run cmd
          line1
          line2
          ⋮ +3 lines
          line6
    `),
  },
  {
    name: "no-output marker",
    parts: [{ kind: "tool-header", labelKey: "tool.label.shell_run", detail: "cmd" }, { kind: "no-output" }],
    cli: dedent(`
      Run cmd
        (No output)
    `),
    chat: dedent(`
      ◆ Run cmd
          (No output)
    `),
  },
  {
    name: "git-status with changes",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_status" },
      { kind: "text", text: "M src/cli.ts" },
      { kind: "text", text: "?? src/new.ts" },
    ],
    cli: dedent(`
      Git Status
        M src/cli.ts
        ?? src/new.ts
    `),
    chat: dedent(`
      ◆ Git Status
          M src/cli.ts
          ?? src/new.ts
    `),
  },
  {
    name: "git-diff with text body",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_diff", detail: "src/agent.ts" },
      { kind: "text", text: "+const x = 1;" },
      { kind: "text", text: "-const y = 2;" },
    ],
    cli: dedent(`
      Git Diff src/agent.ts
        +const x = 1;
        -const y = 2;
    `),
    chat: dedent(`
      ◆ Git Diff src/agent.ts
          +const x = 1;
          -const y = 2;
    `),
  },
  {
    name: "git-diff with truncated output",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_diff" },
      { kind: "text", text: "+line1" },
      { kind: "text", text: "-line2" },
      { kind: "text", text: "⋮ +10 lines" },
      { kind: "text", text: "+line13" },
    ],
    cli: dedent(`
      Git Diff
        +line1
        -line2
        ⋮ +10 lines
        +line13
    `),
    chat: dedent(`
      ◆ Git Diff
          +line1
          -line2
          ⋮ +10 lines
          +line13
    `),
  },
  {
    name: "git-log with commit lines",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_log", detail: "src/cli.ts" },
      { kind: "text", text: "abc1234 feat: add feature" },
      { kind: "text", text: "def5678 fix: resolve bug" },
    ],
    cli: dedent(`
      Git Log src/cli.ts
        abc1234 feat: add feature
        def5678 fix: resolve bug
    `),
    chat: dedent(`
      ◆ Git Log src/cli.ts
          abc1234 feat: add feature
          def5678 fix: resolve bug
    `),
  },
  {
    name: "git-log with truncated output",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_log" },
      { kind: "text", text: "abc1234 first" },
      { kind: "text", text: "def5678 second" },
      { kind: "truncated", count: 8, unit: "lines" },
      { kind: "text", text: "ghi9012 last" },
    ],
    cli: dedent(`
      Git Log
        abc1234 first
        def5678 second
        … +8 lines
        ghi9012 last
    `),
    chat: dedent(`
      ◆ Git Log
          abc1234 first
          def5678 second
          … +8 lines
          ghi9012 last
    `),
  },
  {
    name: "git-show with ref detail",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_show", detail: "abc1234" },
      { kind: "text", text: "feat: add feature" },
      { kind: "text", text: "+const x = 1;" },
    ],
    cli: dedent(`
      Git Show abc1234
        feat: add feature
        +const x = 1;
    `),
    chat: dedent(`
      ◆ Git Show abc1234
          feat: add feature
          +const x = 1;
    `),
  },
  {
    name: "git-add with file paths",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_add", detail: "3 files" },
      { kind: "text", text: "src/a.ts" },
      { kind: "text", text: "src/b.ts" },
      { kind: "text", text: "src/c.ts" },
    ],
    cli: dedent(`
      Git Add 3 files
        src/a.ts
        src/b.ts
        src/c.ts
    `),
    chat: dedent(`
      ◆ Git Add 3 files
          src/a.ts
          src/b.ts
          src/c.ts
    `),
  },
  {
    name: "git-add with truncated file list",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_add", detail: "8 files" },
      { kind: "text", text: "src/a.ts" },
      { kind: "text", text: "src/b.ts" },
      { kind: "truncated", count: 6, unit: "files" },
    ],
    cli: dedent(`
      Git Add 8 files
        src/a.ts
        src/b.ts
        … +6 files
    `),
    chat: dedent(`
      ◆ Git Add 8 files
          src/a.ts
          src/b.ts
          … +6 files
    `),
  },
  {
    name: "git-commit with hash",
    parts: [{ kind: "tool-header", labelKey: "tool.label.git_commit", detail: "feat: add feature (abc1234)" }],
    cli: "Git Commit feat: add feature (abc1234)",
    chat: "◆ Git Commit feat: add feature (abc1234)",
  },
  {
    name: "git-commit with body lines",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "feat: add feature (abc1234)" },
      { kind: "text", text: "Added new auth module" },
      { kind: "text", text: "Updated config schema" },
    ],
    cli: dedent(`
      Git Commit feat: add feature (abc1234)
        Added new auth module
        Updated config schema
    `),
    chat: dedent(`
      ◆ Git Commit feat: add feature (abc1234)
          Added new auth module
          Updated config schema
    `),
  },
  {
    name: "git-commit with truncated body",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.git_commit", detail: "refactor: cleanup (def5678)" },
      { kind: "text", text: "Line 1" },
      { kind: "text", text: "Line 2" },
      { kind: "truncated", count: 5, unit: "lines" },
    ],
    cli: dedent(`
      Git Commit refactor: cleanup (def5678)
        Line 1
        Line 2
        … +5 lines
    `),
    chat: dedent(`
      ◆ Git Commit refactor: cleanup (def5678)
          Line 1
          Line 2
          … +5 lines
    `),
  },
  {
    name: "truncated without unit",
    parts: [
      { kind: "tool-header", labelKey: "tool.label.file_find", detail: "*.ts" },
      { kind: "text", text: "a.ts" },
      { kind: "truncated", count: 5, unit: "matches" },
    ],
    cli: dedent(`
      Find *.ts
        a.ts
        … +5 matches
    `),
    chat: dedent(`
      ◆ Find *.ts
          a.ts
          … +5 matches
    `),
  },
  {
    name: "skill-activate with name",
    parts: [{ kind: "tool-header", labelKey: "tool.label.skill_activate", detail: "build", state: "on" }],
    cli: "Skill build",
    chat: "◈ Skill build",
  },
  {
    name: "skill-deactivate with name",
    parts: [{ kind: "tool-header", labelKey: "tool.label.skill_deactivate", detail: "build", state: "off" }],
    cli: "Skill build",
    chat: "◇ Skill build",
  },
];

describe("tool output TUI — CLI (renderToolOutput)", () => {
  for (const { name, parts, cli } of CASES) {
    test(name, () => {
      expect(renderToolOutput(parts)).toBe(cli);
    });
  }

  test("empty content returns empty string", () => {
    expect(renderToolOutput([])).toBe("");
  });

  test("truncates a long body line to the given width", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", added: 1, removed: 0 },
      { kind: "diff", lineNumber: 1, marker: "add", text: "X".repeat(60) },
    ];
    const [, body] = renderToolOutput(items, 20).split("\n");
    expect(body).toBe(`   1 +${"X".repeat(13)}…`);
    expect(Bun.stringWidth(body)).toBe(20);
  });

  test("middle-truncates a long header at width, keeping the tail filename (F8)", () => {
    const items: ToolOutputPart[] = [
      {
        kind: "tool-header",
        labelKey: "tool.label.shell_run",
        detail: "bun test src/some/really/long/path/module.test.ts",
      },
    ];
    const [header] = renderToolOutput(items, 40).split("\n");
    expect(header.startsWith("Run ")).toBe(true);
    expect(header.endsWith("module.test.ts")).toBe(true);
    expect(header).toContain("…");
    expect(Bun.stringWidth(header)).toBeLessThanOrEqual(40);
  });

  test("omitting the width leaves long lines unwrapped (default path unchanged)", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", added: 1, removed: 0 },
      { kind: "diff", lineNumber: 1, marker: "add", text: "X".repeat(60) },
    ];
    expect(renderToolOutput(items)).toBe(`Edit notes.ts (+1 -0)\n   1 +${"X".repeat(60)}`);
  });
});

describe("tool output TUI — chat (Ink rendering)", () => {
  for (const { name, parts, chat } of CASES) {
    test(name, () => {
      expect(renderChat(parts)).toBe(chat);
    });
  }

  test("truncates a long diff line to the terminal width instead of wrapping", () => {
    const items: ToolOutputPart[] = [
      { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", added: 1, removed: 0 },
      { kind: "diff", lineNumber: 1, marker: "add", text: "X".repeat(80) },
    ];
    const out = renderChat(items, 40); // terminal width 40 → line must fit, not wrap
    const diffLine = out.split("\n").find((line) => line.includes("X")) ?? "";
    expect(diffLine.endsWith("…")).toBe(true); // content was cut, not wrapped
    expect(Bun.stringWidth(diffLine)).toBeLessThanOrEqual(40);
    expect(out).toContain("◆ Edit notes.ts (+1 -0)");
  });

  test("tints the active-skill marker brand and the deactivate marker dim", () => {
    const skillScene = (state: "on" | "off") =>
      layoutTranscriptTool({
        parts: [{ kind: "tool-header", labelKey: "tool.label.skill_activate", detail: "build", state }],
        status: "success",
        columns: 96,
      });
    expect(renderToString(<TerminalSceneRender scene={skillScene("on")} />)).toContain(`${colorToFg(palette.brand)}◈`);
    expect(renderToString(<TerminalSceneRender scene={skillScene("off")} />)).toContain(`${ansi.dim}◇`);
  });

  test("renders stderr in the same style as stdout, without a red channel flag", () => {
    const scene = layoutTranscriptTool({
      parts: [
        { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun run build" },
        { kind: "shell-output", stream: "stdout", text: "identical line" },
        { kind: "shell-output", stream: "stderr", text: "identical line" },
      ],
      status: "complete",
      columns: 96,
    });
    const output = renderToString(<TerminalSceneRender scene={scene} />);
    // stderr is just another output channel — it must not be painted red (SGR 31).
    expect(output).not.toContain("\x1b[31m");
    // Identical text on the two channels renders byte-for-byte the same, proving
    // stderr shares stdout's dim styling rather than a channel-specific color.
    const contentLines = output.split("\n").filter((line) => line.includes("identical line"));
    expect(contentLines).toHaveLength(2);
    expect(contentLines[0]).toBe(contentLines[1]);
  });
});
