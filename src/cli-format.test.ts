import { describe, expect, test } from "bun:test";
import {
  clampLines,
  displayPath,
  formatAssistantReplyOutput,
  formatEditUpdateOutput,
  formatForTool,
  formatRunOutput,
  parseEditResult,
  parseRunExitCode,
  summarizeDiff,
  truncateText,
} from "./cli-format";
import { formatPromptError } from "./error-messages";
import { t } from "./i18n";

describe("cli-format", () => {
  test("formatRunOutput shows stdout content only", () => {
    const payload = Array.from({ length: 15 }, (_, i) => `line-${i + 1}`);
    const raw = ["exit_code=0", "duration_ms=42", "stdout:", ...payload].join("\n");
    const out = formatRunOutput(raw);
    expect(out).not.toContain("exit_code=0");
    expect(out).not.toContain("duration_ms=42");
    expect(out).toContain("line-1");
    expect(out).toContain("… +11 lines");
  });

  test("formatRunOutput hides stderr on success with stdout", () => {
    const raw = ["exit_code=0", "duration_ms=12", "stdout:", "ok", "stderr:", "$ bun run typecheck"].join("\n");
    const out = formatRunOutput(raw);
    expect(out).toBe("ok");
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

  test("formatSearchOutput lists result lines", () => {
    const raw = ["./a.ts:1:foo", "./a.ts:2:bar", "./b.ts:9:baz"].join("\n");
    const out = formatForTool("search", raw);
    expect(out).toBe("./a.ts:1:foo\n./a.ts:2:bar\n./b.ts:9:baz");
  });

  test("formatSearchOutput handles no-match responses", () => {
    expect(formatForTool("search", "No matches.")).toBe(t("tool.content.no_matches"));
    expect(formatForTool("search", "")).toBe(t("tool.content.no_matches"));
  });

  test("formatReadOutput shows content lines", () => {
    const raw = ["one", "two", "three"].join("\n");
    const out = formatForTool("read", raw);
    expect(out).toBe("one\ntwo\nthree");
  });

  test("formatReadOutput normalizes repo-local File path", () => {
    const raw = [`File: ${process.cwd()}/src/cli.ts`, "1: a", "2: b"].join("\n");
    const out = formatForTool("read", raw);
    expect(out).toContain("File: src/cli.ts");
    expect(out).toContain("1: a");
  });

  test("formatDiffOutput shows diff lines", () => {
    const raw = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const out = formatForTool("diff", raw);
    expect(out).toContain("-old");
    expect(out).toContain("+new");
  });

  test("formatGitStatusOutput shows status lines", () => {
    const raw = ["## main...origin/main", " M src/cli.ts", "?? src/new.ts"].join("\n");
    const out = formatForTool("status", raw);
    expect(out).toContain("## main...origin/main");
    expect(out).toContain(" M src/cli.ts");
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
    expect(formatPromptError("insufficient_quota: exceeded")).toBe(
      "Provider quota exceeded. Add billing/credits or switch model/provider.",
    );
    expect(formatPromptError("Remote server stream timed out after 120000ms")).toBe(
      "Server request timed out. Retry or reduce request scope.",
    );
    expect(formatPromptError("Shell command execution is disabled in read mode")).toBe(
      "Write action blocked in read mode. Run /permissions write and retry.",
    );
    expect(formatPromptError("The socket connection was closed unexpectedly.")).toBe(
      "Server unavailable. Start the server and retry.",
    );
    expect(formatPromptError("Remote server error (502): boom")).toBe("Remote server error (502): boom");
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
});
