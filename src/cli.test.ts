import { describe, expect, test } from "bun:test";
import {
  formatForTool,
  formatEditUpdateOutput,
  formatRunOutput,
  formatStatusOutput,
  formatTimestamp,
  summarizeDiff,
  truncateText,
} from "./cli";

describe("cli formatting helpers", () => {
  test("formatRunOutput compresses long stdout", () => {
    const raw = ["exit_code=0", "stdout:", "a", "b", "c", "d", "e"].join("\n");
    const out = formatRunOutput(raw);
    expect(out).toContain("exit_code=0");
    expect(out).toContain("stdout:");
    expect(out).toContain("a");
    expect(out).toContain("… +3 lines");
    expect(out).toContain("e");
  });

  test("formatStatusOutput expands key-value status", () => {
    const out = formatStatusOutput("mode=openai service=acolyte-backend url=http://localhost:8787");
    expect(out).toBe(["mode=openai", "service=acolyte-backend", "url=http://localhost:8787"].join("\n"));
  });

  test("formatSearchOutput includes match and file counts", () => {
    const raw = ["./a.ts:1:foo", "./a.ts:2:bar", "./b.ts:9:baz"].join("\n");
    const out = formatForTool("search", raw);
    expect(out).toContain("3 match(es) in 2 file(s)");
  });

  test("formatReadOutput includes line count", () => {
    const raw = ["one", "two", "three"].join("\n");
    const out = formatForTool("read", raw);
    expect(out).toContain("3 line(s)");
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
    expect(result.preview[0]).toContain("@@ -1,2 +1,3 @@");
  });

  test("formatEditUpdateOutput includes replacement and line summary", () => {
    const diff = ["@@ -1 +1 @@", "-old", "+new"].join("\n");
    const out = formatEditUpdateOutput(1, diff);
    expect(out).toContain("1 replacement(s) applied.");
    expect(out).toContain("Added 1 lines, removed 1 lines.");
  });

  test("truncateText and formatTimestamp stay stable", () => {
    expect(truncateText("abcdef", 4)).toBe("abc…");
    expect(formatTimestamp("2026-02-20T15:06:12.000Z")).toMatch(/^2026-02-20 \d{2}:\d{2}$/);
  });
});
