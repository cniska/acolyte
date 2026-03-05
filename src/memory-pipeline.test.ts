import { describe, expect, test } from "bun:test";
import type { MemorySource } from "./memory-contract";
import { buildMemoryContextPrompt, runMemoryCommitPipeline, runMemoryPipeline } from "./memory-pipeline";

function mockSource(id: string, entries: string[]): MemorySource {
  return {
    id,
    async load() {
      return entries;
    },
  };
}

describe("memory pipeline", () => {
  test("returns empty result when budget is disabled", async () => {
    const result = await runMemoryPipeline([mockSource("stored", ["a"])], {}, 0);
    expect(result.entries).toEqual([]);
    expect(result.tokenEstimate).toBe(0);
  });

  test("keeps source order and fills within budget", async () => {
    const result = await runMemoryPipeline(
      [mockSource("stored", ["first"]), mockSource("distill", ["second"])],
      {},
      10_000,
    );
    expect(result.entries.map((entry) => entry.content)).toEqual(["first", "second"]);
    expect(result.entries.map((entry) => entry.sourceId)).toEqual(["stored", "distill"]);
  });

  test("skips oversized entries and keeps later entries that fit", async () => {
    const result = await runMemoryPipeline([mockSource("distill", ["x".repeat(600), "short"])], {}, 50);
    expect(result.entries.map((entry) => entry.content)).toEqual(["short"]);
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

  test("buildMemoryContextPrompt returns empty for empty entries", () => {
    expect(buildMemoryContextPrompt([])).toBe("");
  });

  test("runMemoryCommitPipeline calls commit in source order", async () => {
    const calls: string[] = [];
    const sources: MemorySource[] = [
      {
        id: "stored",
        async load() {
          return [];
        },
      },
      {
        id: "distill-a",
        async load() {
          return [];
        },
        async commit() {
          calls.push("distill-a");
        },
      },
      {
        id: "distill-b",
        async load() {
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
        async load() {
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
