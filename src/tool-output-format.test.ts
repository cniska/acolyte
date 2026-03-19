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

  test("multi-file diff emits per-file text headers with add/remove counts", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old a",
      "+new a",
      " ctx a",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,2 +1,2 @@",
      "-old b",
      "+new b",
      " ctx b",
    ].join("\n");
    const items = numberedUnifiedDiffLines(diff);
    const textParts = items.filter((i) => i.kind === "text");
    expect(textParts).toEqual([
      { kind: "text", text: "a.ts (+1 -1)" },
      { kind: "text", text: "b.ts (+1 -1)" },
    ]);
  });

  test("single-file diff has no per-file text header", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " ctx",
    ].join("\n");
    const items = numberedUnifiedDiffLines(diff);
    expect(items.filter((i) => i.kind === "text")).toEqual([]);
  });

  test("per-file text headers are always kept during context filtering", () => {
    // Build a multi-file diff where context filtering would normally skip lines.
    // Each file has one change surrounded by many context lines.
    const makeFile = (name: string, ctxCount: number): string[] => {
      const lines = [`diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`];
      lines.push(`@@ -1,${ctxCount + 2} +1,${ctxCount + 2} @@`);
      for (let i = 0; i < ctxCount; i++) lines.push(` context line ${i}`);
      lines.push("-old line");
      lines.push("+new line");
      for (let i = 0; i < ctxCount; i++) lines.push(` trailing context ${i}`);
      return lines;
    };
    const diff = [...makeFile("a.ts", 10), ...makeFile("b.ts", 10)].join("\n");
    const items = numberedUnifiedDiffLines(diff);
    const textParts = items.filter((i) => i.kind === "text");
    expect(textParts).toHaveLength(2);
    expect(textParts[0]).toEqual(expect.objectContaining({ kind: "text", text: expect.stringContaining("a.ts") }));
    expect(textParts[1]).toEqual(expect.objectContaining({ kind: "text", text: expect.stringContaining("b.ts") }));
  });

  test("multi-file truncation cuts at file boundary and reports remaining files", () => {
    // Build enough files to exceed NUMBERED_DIFF_PREVIEW_MAX_LINES (160).
    // Each file has multiple changes to produce enough output after context filtering.
    const makeFile = (name: string): string[] => [
      `diff --git a/${name} b/${name}`,
      `--- a/${name}`,
      `+++ b/${name}`,
      `@@ -1,30 +1,30 @@`,
      "-import { createId } from './short-id';",
      "+import { generateId } from './short-id';",
      ...Array.from({ length: 10 }, (_, i) => ` middle line ${i}`),
      `-  const id = createId();`,
      `+  const id = generateId();`,
      ...Array.from({ length: 10 }, (_, i) => ` trailing line ${i}`),
      "-  return createId();",
      "+  return generateId();",
      ...Array.from({ length: 5 }, (_, i) => ` end line ${i}`),
    ];
    const files = Array.from({ length: 30 }, (_, i) => `file${i}.ts`);
    const diff = files.flatMap((name) => makeFile(name)).join("\n");
    const items = numberedUnifiedDiffLines(diff);

    // Should not cut mid-file — last item should be a truncated marker.
    const lastItem = items[items.length - 1];
    expect(lastItem?.kind).toBe("truncated");

    // Every file header must be followed by at least one diff line (no orphan headers).
    for (let i = 0; i < items.length; i++) {
      if (items[i]?.kind === "text") {
        const next = items.slice(i + 1).find((p) => p.kind !== "truncated");
        if (next) expect(next.kind).toBe("diff");
      }
    }
  });

  test("orphan file headers with no diff content are removed", () => {
    // Two files but the second has only context lines (no changes) — its header should be removed.
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      " ctx",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,3 +1,3 @@",
      " only context",
      " more context",
      " trailing",
    ].join("\n");
    const items = numberedUnifiedDiffLines(diff);
    const textParts = items.filter((i) => i.kind === "text");
    // b.ts has no changes so its header should not appear; a.ts keeps its header.
    expect(textParts).toEqual([{ kind: "text", text: "a.ts (+1 -1)" }]);
  });
});
