import { describe, expect, test } from "bun:test";
import {
  clampLines,
  countLabel,
  displayPath,
  formatAssistantReplyOutput,
  formatEditUpdateOutput,
  formatForTool,
  formatProgressOutput,
  formatPromptError,
  formatRunOutput,
  parseEditResult,
  parseRunExitCode,
  summarizeDiff,
  truncateText,
} from "./cli-format";

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
function withColumns(width: number, task: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", { configurable: true, value: width });
  try {
    task();
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "columns", descriptor);
    else delete (process.stdout as { columns?: number }).columns;
  }
}

describe("cli-format", () => {
  test("formatRunOutput compresses long stdout", () => {
    const payload = Array.from({ length: 15 }, (_, i) => `line-${i + 1}`);
    const raw = ["exit_code=0", "duration_ms=42", "stdout:", ...payload].join("\n");
    const out = formatRunOutput(raw);
    expect(out).toContain("exit_code=0");
    expect(out).toContain("duration_ms=42");
    expect(out).toContain("stdout:");
    expect(out).toContain("line-1");
    expect(out).toContain("… +11 lines");
    expect(out).not.toContain("line-15");
  });

  test("formatRunOutput hides shell echo noise in successful stderr", () => {
    const raw = ["exit_code=0", "duration_ms=12", "stdout:", "ok", "stderr:", "$ bun run typecheck"].join("\n");
    const out = formatRunOutput(raw);
    expect(out).toContain("stdout:");
    expect(out).toContain("ok");
    expect(out).not.toContain("stderr:");
  });

  test("parseRunExitCode reads exit code from run output", () => {
    expect(parseRunExitCode("exit_code=0\nduration_ms=20")).toBe(0);
    expect(parseRunExitCode("exit_code=17\nstdout:\nnope")).toBe(17);
    expect(parseRunExitCode("stdout:\nmissing")).toBeNull();
  });

  test("parseEditResult parses strict edit metadata", () => {
    expect(parseEditResult("path=/tmp/a.ts\nedits=2\ndry_run=true")).toEqual({
      path: "/tmp/a.ts",
      edits: 2,
      dryRun: true,
    });
    expect(parseEditResult("path=/tmp/a.ts\nedits=2\ndry_run=false")).toEqual({
      path: "/tmp/a.ts",
      edits: 2,
      dryRun: false,
    });
    expect(parseEditResult("path=/tmp/a.ts\nedits=2\ndry_run=maybe")).toBeNull();
  });

  test("formatSearchOutput includes match and file counts", () => {
    const raw = ["./a.ts:1:foo", "./a.ts:2:bar", "./b.ts:9:baz"].join("\n");
    const out = formatForTool("search", raw);
    expect(out).toContain("3 matches in 2 files");
  });

  test("formatSearchOutput handles no-match responses", () => {
    expect(formatForTool("search", "No matches.")).toBe("No matches.");
    expect(formatForTool("search", "")).toBe("No matches.");
  });

  test("formatReadOutput includes line count", () => {
    const raw = ["one", "two", "three"].join("\n");
    const out = formatForTool("read", raw);
    expect(out).toContain("3 lines");
  });

  test("formatReadOutput normalizes repo-local File path", () => {
    const raw = [`File: ${process.cwd()}/src/cli.ts`, "1: a", "2: b"].join("\n");
    const out = formatForTool("read", raw);
    expect(out).toContain("2 lines");
    expect(out).toContain("File: src/cli.ts");
  });

  test("formatDiffOutput includes file and line summary", () => {
    const raw = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const out = formatForTool("diff", raw);
    expect(out).toContain("1 file changed, +1 -1");
  });

  test("formatGitStatusOutput includes changed-file summary", () => {
    const raw = ["## main...origin/main", " M src/cli.ts", "?? src/new.ts"].join("\n");
    const out = formatForTool("status", raw);
    expect(out).toContain("2 changed files");
    expect(out).toContain("## main...origin/main");
  });

  test("summarizeDiff counts added and removed lines", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "index 123..456 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,3 @@",
      "-old",
      "+new",
      "+extra",
      " context",
    ].join("\n");
    const result = summarizeDiff(diff);
    expect(result.added).toBe(2);
    expect(result.removed).toBe(1);
    expect(result.locations).toBe(1);
    expect(result.preview[0]).toContain("@@ -1,2 +1,3 @@");
    expect(result.preview.some((line) => line.includes("-old"))).toBe(true);
    expect(result.preview.some((line) => line.includes("+new"))).toBe(true);
  });

  test("formatEditUpdateOutput includes replacement and line summary", () => {
    const diff = ["@@ -1 +1 @@", "-old", "+new"].join("\n");
    const out = formatEditUpdateOutput(1, diff);
    expect(out).toContain("1 replacement applied.");
    expect(out).toContain("1 location updated.");
    expect(out).toContain("Added 1 line, removed 1 line.");
    expect(out).toContain("Preview:");
    expect(out).toContain("@@ -1 +1 @@");
  });

  test("formatEditUpdateOutput explains when diff preview is unavailable", () => {
    const out = formatEditUpdateOutput(1, "");
    expect(out).toContain("1 replacement applied.");
    expect(out).toContain("No diff preview available");
  });

  test("truncateText stays stable", () => {
    expect(truncateText("abcdef", 4)).toBe("abc…");
    expect(truncateText("ab", 4)).toBe("ab");
  });

  test("countLabel uses singular and plural correctly", () => {
    expect(countLabel(0, "file", "files")).toBe("0 files");
    expect(countLabel(1, "file", "files")).toBe("1 file");
    expect(countLabel(3, "file", "files")).toBe("3 files");
  });

  test("clampLines truncates with overflow message", () => {
    const lines = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const clamped = clampLines(lines, 4);
    expect(clamped).toHaveLength(4);
    expect(clamped[3]).toBe("… +7 lines");
  });

  test("clampLines allows overflow tolerance", () => {
    const lines = ["a", "b", "c", "d", "e"];
    expect(clampLines(lines, 4, 2)).toEqual(lines);
    expect(clampLines(lines, 2, 1)).toHaveLength(2);
  });

  test("displayPath returns relative path within cwd", () => {
    const abs = `${process.cwd()}/src/cli.ts`;
    expect(displayPath(abs)).toBe("src/cli.ts");
  });

  test("displayPath keeps absolute path outside cwd", () => {
    expect(displayPath("/tmp/other/file.ts")).toBe("/tmp/other/file.ts");
  });

  test("formatPromptError maps actionable one-shot failures", () => {
    expect(formatPromptError(new Error("insufficient_quota: exceeded"))).toBe(
      "Provider quota exceeded. Add billing/credits or switch model/provider.",
    );
    expect(formatPromptError(new Error("Remote server stream timed out after 120000ms"))).toBe(
      "Server request timed out. Retry or reduce request scope.",
    );
    expect(formatPromptError(new Error("Shell command execution is disabled in read mode"))).toBe(
      "Write action blocked in read mode. Run /permissions write and retry.",
    );
    expect(formatPromptError(new Error("The socket connection was closed unexpectedly."))).toBe(
      "Server unavailable. Start the server and retry.",
    );
    expect(formatPromptError(new Error("Remote server error (502): boom"))).toBe("Remote server error (502): boom");
  });

  test("formatAssistantReplyOutput indents multiline assistant output", () => {
    const out = formatAssistantReplyOutput(["1. first", "2. second", "3. third"].join("\n"));
    expect(out).toBe(["• 1. first", "  2. second", "  3. third"].join("\n"));
  });

  test("formatAssistantReplyOutput preserves blank lines without trailing spaces", () => {
    const out = formatAssistantReplyOutput(["Summary", "", "Next step"].join("\n"));
    expect(out).toBe(["• Summary", "", "  Next step"].join("\n"));
  });

  test("formatAssistantReplyOutput wraps long lines with stable indentation", () => {
    const out = formatAssistantReplyOutput("1. first second third fourth fifth", 16);
    const lines = out.split("\n");
    expect(lines[0]).toBe("• 1. first second third");
    expect(lines[1]).toMatch(/^\s+fourth fifth$/);
  });

  test("formatProgressOutput styles Edit header like file tools", () => {
    const out = formatProgressOutput("Edit src/main.rs");
    expect(out).toContain("• ");
    expect(out).toContain("\x1b[1mEdit \x1b[22m");
    expect(out).toContain("\x1b[2msrc/main.rs\x1b[22m");
  });

  test("formatProgressOutput styles Run header with dim command", () => {
    const out = formatProgressOutput("Run rustc ./sum.rs -o ./sum && ./sum 1 2 3 4");
    expect(out).toContain("• ");
    expect(out).toContain("\x1b[1mRun \x1b[22m");
    expect(out).toContain("\x1b[2mrustc ./sum.rs -o ./sum && ./sum 1 2 3 4\x1b[22m");
  });

  test("formatProgressOutput wraps long Run header and aligns continuation with detail", () => {
    withColumns(56, () => {
      const longCommand = "bun run verify --filter=very-long-module-name --module another-super-long-module-name";
      const plain = stripAnsi(formatProgressOutput(`Run ${longCommand}`));
      const lines = plain.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]?.startsWith("• Run ")).toBe(true);
      expect(lines[1]?.startsWith("      ")).toBe(true);
      expect(lines[1]?.startsWith("• ")).toBe(false);
    });
  });

  test("formatProgressOutput ignores leading blank lines", () => {
    const out = formatProgressOutput("\nReview 1 file\nscripts/reverse-word.ts");
    const lines = out.split("\n");
    expect(lines[0]).toContain("• ");
    expect(lines[0]).toContain("Review");
    expect(lines[1]).toContain("scripts/reverse-word.ts");
    expect(lines.filter((line) => line === "•").length).toBe(0);
  });

  test("formatProgressOutput renders structured read header and body rows", () => {
    const out = formatProgressOutput("Read paths=2 targets=[a.ts, b.ts]\na.ts\nb.ts");
    expect(stripAnsi(out)).toBe("• Read paths=2 targets=[a.ts, b.ts]\n    a.ts\n    b.ts");
  });

  test("formatProgressOutput renders structured edit header and hides +/- markers", () => {
    const out = formatProgressOutput(
      [
        "Edit path=src/a.ts files=1 added=1 removed=1",
        "9  const x = 1;",
        "10 - const y = 2;",
        "10 + const y = 3;",
      ].join("\n"),
    );
    const plain = stripAnsi(out);
    expect(plain).toContain("• Edit path=src/a.ts files=1 added=1 removed=1");
    expect(plain).toContain("    9  const x = 1;");
    expect(plain).toContain("   10  const y = 2;");
    expect(plain).toContain("   10  const y = 3;");
    expect(plain).not.toContain("10 - const y = 2;");
    expect(plain).not.toContain("10 + const y = 3;");
  });
});
