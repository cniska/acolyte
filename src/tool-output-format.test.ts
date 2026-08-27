import { describe, expect, test } from "bun:test";
import type { ToolOutputPart } from "./tool-output-contract";
import { contentParts, shellTailParts, textHeadParts, toolLabelKey, webSearchSummary } from "./tool-output-format";
import { findResultPaths, numberedUnifiedDiffLines, searchResultSummaryStats } from "./tool-output-parse";
import { renderToolOutput } from "./tool-output-render";

describe("textHeadParts", () => {
  // A clean `git status` and a `git diff` with no changes both land here. A blank row reads as
  // output that happened to be empty; nothing at all reads as a tool that failed to report.
  test("empty output is stated as such", () => {
    expect(textHeadParts("", 5)).toEqual([{ kind: "no-output" }]);
    expect(textHeadParts("\n", 5)).toEqual([{ kind: "no-output" }]);
  });

  test("few lines within the head returns all of them", () => {
    expect(textHeadParts("alpha\nbeta\ngamma", 5)).toEqual([
      { kind: "text", text: "alpha" },
      { kind: "text", text: "beta" },
      { kind: "text", text: "gamma" },
    ]);
  });

  test("more lines than the head returns the head and the count that follows", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const parts = textHeadParts(lines, 2);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ kind: "text", text: "line-0" });
    expect(parts[1]).toEqual({ kind: "text", text: "line-1" });
    expect(parts[2]).toEqual({ kind: "truncated", count: 18, unit: "lines" });
    expect(renderToolOutput(parts[2] as ToolOutputPart)).toBe("⋮ +18 lines");
  });

  // A status column and a diff's indentation are content: trimming them shows something else.
  test("keeps each line verbatim", () => {
    expect(textHeadParts(" M src/a.ts\n   context line", 5)).toEqual([
      { kind: "text", text: " M src/a.ts" },
      { kind: "text", text: "   context line" },
    ]);
  });
});

describe("contentParts", () => {
  // A file's indentation and blank lines are its content: trimming them would show a file that is
  // not the one on disk.
  test("keeps lines verbatim, blank lines and indentation included, numbered from one", () => {
    expect(contentParts("export const a = 1;\n\n  indented\n")).toEqual([
      { kind: "content", lineNumber: 1, text: "export const a = 1;" },
      { kind: "content", lineNumber: 2, text: "" },
      { kind: "content", lineNumber: 3, text: "  indented" },
    ]);
  });

  // The transcript is the only record of what a write changed, so a create leaves nothing out.
  test("keeps every line, however long the file", () => {
    const content = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
    const parts = contentParts(content);
    expect(parts).toHaveLength(500);
    expect(parts[499]).toEqual({ kind: "content", lineNumber: 500, text: "line 500" });
    expect(parts.filter((part) => part.kind === "truncated")).toHaveLength(0);
  });

  test("a trailing newline is not counted as a line", () => {
    expect(contentParts("only\n")).toEqual([{ kind: "content", lineNumber: 1, text: "only" }]);
  });

  test("an empty file has no lines to show", () => {
    expect(contentParts("")).toEqual([]);
  });
});

describe("shellTailParts", () => {
  // A command's answer is at the bottom: a head would spend rows on the runner starting up.
  test("keeps the last rows and states what it dropped, with no head", () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ stream: "stdout" as const, text: `line-${i}` }));
    const parts = shellTailParts(lines, 3);
    expect(parts).toEqual([
      { kind: "truncated", count: 17, unit: "lines" },
      { kind: "shell-output", stream: "stdout", text: "line-17" },
      { kind: "shell-output", stream: "stdout", text: "line-18" },
      { kind: "shell-output", stream: "stdout", text: "line-19" },
    ]);
  });

  test("keeps every row when the output fits", () => {
    const lines = [{ stream: "stdout" as const, text: "only" }];
    expect(shellTailParts(lines, 3)).toEqual([{ kind: "shell-output", stream: "stdout", text: "only" }]);
  });

  test("empty output is stated as such", () => {
    expect(shellTailParts([], 3)).toEqual([{ kind: "no-output" }]);
  });
});

describe("webSearchSummary", () => {
  test("summarizes a single result as a localized count", () => {
    const raw = ["1. Bun runtime docs", "   https://bun.sh/docs", "   Fast all-in-one JavaScript runtime."].join("\n");
    expect(webSearchSummary(raw)).toBe("1 result");
  });

  test("summarizes no results as a zero count", () => {
    expect(webSearchSummary("No web results found for: missing query")).toBe("0 results");
  });

  test("counts every result regardless of how many exist", () => {
    const raw = Array.from({ length: 7 }, (_, i) => `${i + 1}. Result ${i + 1}\n   https://r${i + 1}.test`).join("\n");
    expect(webSearchSummary(raw)).toBe("7 results");
  });

  test("summarizes blank output as a zero count", () => {
    expect(webSearchSummary("   \n  \n")).toBe("0 results");
  });
});

describe("findResultPaths", () => {
  test("extracts only lines starting with ./", () => {
    const input = "./src/foo.ts\nsome noise\n./lib/bar.ts\n";
    expect(findResultPaths(input)).toEqual(["./src/foo.ts", "./lib/bar.ts"]);
  });

  test("empty or no-match returns empty array", () => {
    expect(findResultPaths("")).toEqual([]);
    expect(findResultPaths("no paths here\nnope")).toEqual([]);
  });
});

describe("searchResultSummaryStats", () => {
  test("parses grep-style output into file and match counts", () => {
    const result = [
      "./src/foo.ts:10:const hello = true;",
      "./src/foo.ts:20:let hello = false;",
      "./src/bar.ts:5:hello world",
    ].join("\n");
    const stats = searchResultSummaryStats(result, ["hello"]);
    expect(stats).toEqual({ files: 2, matches: 3 });
  });
});

describe("numberedUnifiedDiffLines", () => {
  test("parses a simple unified diff and returns diff output items", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,4 @@",
      " line one",
      "-old line",
      "+new line",
      "+added line",
      " line three",
    ].join("\n");
    const items = numberedUnifiedDiffLines(diff);
    expect(items.length).toBeGreaterThan(0);
    const adds = items.filter((i) => i.kind === "diff" && i.marker === "add");
    const removes = items.filter((i) => i.kind === "diff" && i.marker === "remove");
    const contexts = items.filter((i) => i.kind === "diff" && i.marker === "context");
    expect(adds.length).toBe(2);
    expect(removes.length).toBe(1);
    expect(contexts.length).toBe(2);
  });

  test("empty or no-diff input returns empty array", () => {
    expect(numberedUnifiedDiffLines("")).toEqual([]);
    expect(numberedUnifiedDiffLines("just some text\nno diff here")).toEqual([]);
  });
});

describe("toolLabelKey", () => {
  test("returns label key for known tool", () => {
    expect(toolLabelKey("file-read")).toBe("tool.label.file_read");
    expect(toolLabelKey("git-commit")).toBe("tool.label.git_commit");
  });

  test("falls back to tool id for unknown tool", () => {
    expect(toolLabelKey("unknown-tool")).toBe("unknown-tool");
  });
});
