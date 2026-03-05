import { describe, expect, test } from "bun:test";
import type { MemorySource } from "./memory-contract";
import {
  buildMemoryContextPrompt,
  normalizeMemoryEntries,
  runMemoryCommitPipeline,
  runMemoryPipeline,
  selectMemoryEntries,
} from "./memory-pipeline";
import { createMemorySource } from "./test-utils";

describe("memory pipeline", () => {
  test("returns empty result when budget is disabled", async () => {
    const result = await runMemoryPipeline([createMemorySource("stored", ["a"])], {}, 0);
    expect(result.entries).toEqual([]);
    expect(result.tokenEstimate).toBe(0);
  });

  test("keeps source order and fills within budget", async () => {
    const result = await runMemoryPipeline(
      [createMemorySource("stored", ["first"]), createMemorySource("distill", ["second"])],
      {},
      10_000,
    );
    expect(result.entries.map((entry) => entry.content)).toEqual(["first", "second"]);
    expect(result.entries.map((entry) => entry.sourceId)).toEqual(["stored", "distill"]);
  });

  test("skips oversized entries and keeps later entries that fit", async () => {
    const result = await runMemoryPipeline([createMemorySource("distill", ["x".repeat(600), "short"])], {}, 50);
    expect(result.entries.map((entry) => entry.content)).toEqual(["short"]);
  });

  test("runMemoryPipeline accepts injected selection strategy", async () => {
    const result = await runMemoryPipeline(
      [createMemorySource("stored", ["a", "b"])],
      {},
      10_000,
      normalizeMemoryEntries,
      (entries) => ({ entries: [entries[entries.length - 1]], tokenEstimate: entries[entries.length - 1].tokenEstimate }),
    );
    expect(result.entries.map((entry) => entry.content)).toEqual(["b"]);
  });

  test("runMemoryPipeline accepts injected normalization strategy", async () => {
    const result = await runMemoryPipeline(
      [createMemorySource("stored", ["ignored"])],
      {},
      10_000,
      async () => [{ sourceId: "custom", content: "normalized", tokenEstimate: 2 }],
      selectMemoryEntries,
    );
    expect(result.entries.map((entry) => entry.content)).toEqual(["normalized"]);
    expect(result.entries.map((entry) => entry.sourceId)).toEqual(["custom"]);
  });

  test("buildMemoryContextPrompt renders bullet list", () => {
    const prompt = buildMemoryContextPrompt([
      { sourceId: "stored", content: "prefer bun", tokenEstimate: 3 },
      { sourceId: "distill", content: "Current task: fix tests", tokenEstimate: 5 },
    ]);
    expect(prompt.startsWith("Memory context:")).toBe(true);
    expect(prompt).toContain("- prefer bun");
    expect(prompt).toContain("- Current task: fix tests");
  });

  test("buildMemoryContextPrompt indents multiline entries", () => {
    const prompt = buildMemoryContextPrompt([
      { sourceId: "distill", content: "line one\nline two", tokenEstimate: 5 },
    ]);
    expect(prompt).toContain("- line one\n  line two");
  });

  test("buildMemoryContextPrompt returns empty for empty entries", () => {
    expect(buildMemoryContextPrompt([])).toBe("");
  });

  test("normalizeMemoryEntries keeps source and content order", async () => {
    const entries = await normalizeMemoryEntries(
      [createMemorySource("stored", ["first"]), createMemorySource("distill", ["second", "third"])],
      {},
    );
    expect(entries.map((entry) => entry.sourceId)).toEqual(["stored", "distill", "distill"]);
    expect(entries.map((entry) => entry.content)).toEqual(["first", "second", "third"]);
  });

  test("normalizeMemoryEntries skips blank entries", async () => {
    const entries = await normalizeMemoryEntries(
      [createMemorySource("stored", ["", "  ", "kept"])],
      {},
    );
    expect(entries.map((entry) => entry.content)).toEqual(["kept"]);
  });

  test("selectMemoryEntries applies budget with skip-on-oversize behavior", () => {
    const selected = selectMemoryEntries(
      [
        { sourceId: "stored", content: "x".repeat(600), tokenEstimate: 200 },
        { sourceId: "distill", content: "short", tokenEstimate: 2 },
      ],
      50,
    );
    expect(selected.entries.map((entry) => entry.content)).toEqual(["short"]);
    expect(selected.tokenEstimate).toBe(2);
  });

  test("selectMemoryEntries prioritizes continuation entries under tight budget", () => {
    const selected = selectMemoryEntries(
      [
        { sourceId: "stored", content: "general note", tokenEstimate: 4 },
        { sourceId: "distill", content: "Current task: implement memory strategy", tokenEstimate: 4, isContinuation: true },
        { sourceId: "distill", content: "another note", tokenEstimate: 4 },
      ],
      4,
    );
    expect(selected.entries.map((entry) => entry.content)).toEqual(["Current task: implement memory strategy"]);
    expect(selected.tokenEstimate).toBe(4);
  });

  test("selectMemoryEntries treats continuation only when explicitly flagged", () => {
    const selected = selectMemoryEntries(
      [
        { sourceId: "stored", content: "general note", tokenEstimate: 3 },
        { sourceId: "distill", content: "- Current task: ship memory", tokenEstimate: 3, isContinuation: true },
      ],
      3,
    );
    expect(selected.entries.map((entry) => entry.content)).toEqual(["- Current task: ship memory"]);
  });

  test("selectMemoryEntries prefers most recent continuation entry", () => {
    const selected = selectMemoryEntries(
      [
        { sourceId: "stored", content: "Current task: old", tokenEstimate: 3, isContinuation: true },
        { sourceId: "distill", content: "Current task: new", tokenEstimate: 3, isContinuation: true },
      ],
      6,
    );
    expect(selected.entries.map((entry) => entry.content)).toEqual(["Current task: new"]);
  });

  test("selectMemoryEntries falls back to older continuation when freshest does not fit", () => {
    const selected = selectMemoryEntries(
      [
        { sourceId: "stored", content: "Current task: older", tokenEstimate: 3, isContinuation: true },
        { sourceId: "distill", content: "Current task: freshest but too large", tokenEstimate: 10, isContinuation: true },
      ],
      3,
    );
    expect(selected.entries.map((entry) => entry.content)).toEqual(["Current task: older"]);
  });

  test("selectMemoryEntries skips duplicate content entries", () => {
    const selected = selectMemoryEntries(
      [
        { sourceId: "stored", content: "same", tokenEstimate: 2 },
        { sourceId: "distill", content: "same", tokenEstimate: 2 },
        { sourceId: "distill", content: "different", tokenEstimate: 2 },
      ],
      10,
    );
    expect(selected.entries.map((entry) => entry.content)).toEqual(["same", "different"]);
    expect(selected.tokenEstimate).toBe(4);
  });

  test("selectMemoryEntries dedupes case and whitespace variants", () => {
    const selected = selectMemoryEntries(
      [
        { sourceId: "stored", content: "Current task: Fix tests", tokenEstimate: 3, isContinuation: true },
        { sourceId: "distill", content: "  current   task:   fix tests  ", tokenEstimate: 3, isContinuation: true },
      ],
      10,
    );
    expect(selected.entries).toHaveLength(1);
    expect(selected.entries[0]?.content.trim().toLowerCase().replace(/\s+/g, " ")).toBe("current task: fix tests");
  });

  test("runMemoryCommitPipeline calls commit in source order", async () => {
    const calls: string[] = [];
    const sources: MemorySource[] = [
      {
        id: "stored",
        async loadEntries() {
          return [];
        },
      },
      {
        id: "distill-a",
        async loadEntries() {
          return [];
        },
        async commit() {
          calls.push("distill-a");
        },
      },
      {
        id: "distill-b",
        async loadEntries() {
          return [];
        },
        async commit() {
          calls.push("distill-b");
        },
      },
    ];

    await runMemoryCommitPipeline(sources, { messages: [], output: "done" });
    expect(calls).toEqual(["distill-a", "distill-b"]);
  });

  test("runMemoryCommitPipeline bubbles commit errors", async () => {
    const sources: MemorySource[] = [
      {
        id: "distill",
        async loadEntries() {
          return [];
        },
        async commit() {
          throw new Error("commit failed");
        },
      },
    ];
    await expect(runMemoryCommitPipeline(sources, { messages: [], output: "done" })).rejects.toThrow("commit failed");
  });
});
