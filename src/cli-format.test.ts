import { describe, expect, test } from "bun:test";
import { clampLines, displayPath, formatAssistantReplyOutput, formatForTool, formatRunOutput } from "./cli-format";
import { truncateText } from "./compact-text";
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

  test("formatForTool formats search-files output", () => {
    const raw = ["./a.ts:1:foo", "./a.ts:2:bar", "./b.ts:9:baz"].join("\n");
    const out = formatForTool("search-files", raw);
    expect(out).toBe("./a.ts:1:foo\n./a.ts:2:bar\n./b.ts:9:baz");
  });

  test("formatForTool handles no-match search responses", () => {
    expect(formatForTool("search-files", "No matches.")).toBe(t("tool.content.no_matches"));
    expect(formatForTool("search-files", "")).toBe(t("tool.content.no_matches"));
  });

  test("formatForTool formats read-file output", () => {
    const raw = ["one", "two", "three"].join("\n");
    const out = formatForTool("read-file", raw);
    expect(out).toBe("one\ntwo\nthree");
  });

  test("formatForTool normalizes repo-local File path in read output", () => {
    const raw = [`File: ${process.cwd()}/src/cli.ts`, "1: a", "2: b"].join("\n");
    const out = formatForTool("read-file", raw);
    expect(out).toContain("File: src/cli.ts");
    expect(out).toContain("1: a");
  });

  test("formatForTool formats git-diff output", () => {
    const raw = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const out = formatForTool("git-diff", raw);
    expect(out).toContain("-old");
    expect(out).toContain("+new");
  });

  test("formatForTool formats git-status output", () => {
    const raw = ["## main...origin/main", " M src/cli.ts", "?? src/new.ts"].join("\n");
    const out = formatForTool("git-status", raw);
    expect(out).toContain("## main...origin/main");
    expect(out).toContain("M src/cli.ts");
  });

  test("formatForTool falls back to read formatting for unknown tools", () => {
    const raw = ["line1", "line2"].join("\n");
    const out = formatForTool("unknown-tool", raw);
    expect(out).toBe("line1\nline2");
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
