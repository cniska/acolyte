import { describe, expect, test } from "bun:test";
import { resultChunkParts, textHeadTailParts, toolLabelKey, webSearchSummaryParts } from "./tool-output-format";
import { findResultPaths, numberedUnifiedDiffLines, searchResultSummaryStats } from "./tool-output-parse";

describe("textHeadTailParts", () => {
  test("empty input returns single no-output part", () => {
    const parts = textHeadTailParts("");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ kind: "no-output" });
  });

  test("few lines within head+tail returns all lines as text", () => {
    const parts = textHeadTailParts("alpha\nbeta\ngamma");
    expect(parts).toHaveLength(3);
    expect(parts).toEqual([
      { kind: "text", text: "alpha" },
      { kind: "text", text: "beta" },
      { kind: "text", text: "gamma" },
    ]);
  });

  test("many lines returns head + omitted + tail", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const parts = textHeadTailParts(lines, { headRows: 2, tailRows: 2 });
    // head (2) + omitted (1) + tail (2) = 5
    expect(parts).toHaveLength(5);
    expect(parts[0]).toEqual({ kind: "text", text: "line-0" });
    expect(parts[1]).toEqual({ kind: "text", text: "line-1" });
    expect(parts[2]).toEqual({ kind: "text", text: "⋮ +16 lines" });
    expect(parts[3]).toEqual({ kind: "text", text: "line-18" });
    expect(parts[4]).toEqual({ kind: "text", text: "line-19" });
  });
});

describe("resultChunkParts", () => {
  test("within limit returns all lines", () => {
    const parts = resultChunkParts("a\nb\nc", 10);
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.kind === "text")).toBe(true);
  });

  test("over limit returns truncated part at end", () => {
    const input = Array.from({ length: 10 }, (_, i) => `row-${i}`).join("\n");
    const parts = resultChunkParts(input, 3);
    // 3 text + 1 truncated
    expect(parts).toHaveLength(4);
    expect(parts[3]).toEqual({ kind: "truncated", count: 7, unit: "lines" });
  });
});

describe("webSearchSummaryParts", () => {
  test("summarizes a single result as a localized count", () => {
    const raw = ["1. Bun runtime docs", "   https://bun.sh/docs", "   Fast all-in-one JavaScript runtime."].join("\n");
    expect(webSearchSummaryParts(raw)).toEqual([{ kind: "text", text: "1 result" }]);
  });

  test("summarizes no results as a zero count", () => {
    expect(webSearchSummaryParts("No web results found for: missing query")).toEqual([
      { kind: "text", text: "0 results" },
    ]);
  });

  test("counts every result regardless of how many exist", () => {
    const raw = Array.from({ length: 7 }, (_, i) => `${i + 1}. Result ${i + 1}\n   https://r${i + 1}.test`).join("\n");
    expect(webSearchSummaryParts(raw)).toEqual([{ kind: "text", text: "7 results" }]);
  });

  test("summarizes blank output as a zero count", () => {
    expect(webSearchSummaryParts("   \n  \n")).toEqual([{ kind: "text", text: "0 results" }]);
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
