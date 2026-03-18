import { describe, expect, test } from "bun:test";
import type { ToolOutputPart } from "./tool-output-content";
import {
  emitHeadTailLines,
  emitResultChunks,
  findResultPaths,
  numberedUnifiedDiffLines,
  searchResultSummaryEntries,
  type ToolOutputListener,
} from "./tool-output-format";

function collect() {
  const events: Array<{ toolName: string; content: ToolOutputPart }> = [];
  const listener: ToolOutputListener = (e) => events.push({ toolName: e.toolName, content: e.content });
  return { events, listener };
}

describe("emitHeadTailLines", () => {
  test("empty input emits single no-output event", () => {
    const { events, listener } = collect();
    emitHeadTailLines("test", "", listener, "call-1");
    expect(events).toHaveLength(1);
    expect(events[0]?.content).toEqual({ kind: "no-output" });
  });

  test("few lines within head+tail emits all lines as text", () => {
    const { events, listener } = collect();
    emitHeadTailLines("test", "alpha\nbeta\ngamma", listener, "call-2");
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.content)).toEqual([
      { kind: "text", text: "alpha" },
      { kind: "text", text: "beta" },
      { kind: "text", text: "gamma" },
    ]);
  });

  test("many lines emits head + truncated + tail", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const { events, listener } = collect();
    emitHeadTailLines("test", lines, listener, "call-3", { headRows: 2, tailRows: 2 });
    // head (2) + truncated (1) + tail (2) = 5
    expect(events).toHaveLength(5);
    expect(events[0]?.content).toEqual({ kind: "text", text: "line-0" });
    expect(events[1]?.content).toEqual({ kind: "text", text: "line-1" });
    expect(events[2]?.content).toEqual({ kind: "truncated", count: 16, unit: "lines" });
    expect(events[3]?.content).toEqual({ kind: "text", text: "line-18" });
    expect(events[4]?.content).toEqual({ kind: "text", text: "line-19" });
  });
});

describe("emitResultChunks", () => {
  test("within limit emits all lines", () => {
    const { events, listener } = collect();
    emitResultChunks("test", "a\nb\nc", listener, 10);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.content.kind === "text")).toBe(true);
  });

  test("over limit emits truncated event at end", () => {
    const input = Array.from({ length: 10 }, (_, i) => `row-${i}`).join("\n");
    const { events, listener } = collect();
    emitResultChunks("test", input, listener, 3);
    // 3 text + 1 truncated
    expect(events).toHaveLength(4);
    const last = events[3]?.content;
    expect(last).toEqual({ kind: "truncated", count: 7, unit: "lines" });
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

describe("searchResultSummaryEntries", () => {
  test("parses grep-style output with pattern and returns entries", () => {
    const result = [
      "./src/foo.ts:10:const hello = true;",
      "./src/foo.ts:20:let hello = false;",
      "./src/bar.ts:5:hello world",
    ].join("\n");
    const entries = searchResultSummaryEntries(result, ["hello"]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.path).toBe("./src/foo.ts");
    expect(entries[0]?.hits.length).toBeGreaterThan(0);
    expect(entries[1]?.path).toBe("./src/bar.ts");
    expect(entries[1]?.hits.length).toBeGreaterThan(0);
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
