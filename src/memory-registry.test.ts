import { describe, expect, test } from "bun:test";
import type { MemorySource } from "./memory-contract";
import { createMemoryRegistry, resolveMemorySources } from "./memory-registry";

function mockSource(id: string, entries: string[], onCommit?: () => void): MemorySource {
  return {
    id,
    async load() {
      return entries;
    },
    commit: onCommit
      ? async () => {
          onCommit();
        }
      : undefined,
  };
}

describe("memory registry", () => {
  test("resolveMemorySources preserves configured order", () => {
    const sources = resolveMemorySources(["distill", "stored"]);
    expect(sources.map((source) => source.id)).toEqual(["distill", "stored"]);
  });

  test("resolveMemorySources deduplicates repeated source ids", () => {
    const sources = resolveMemorySources(["stored", "stored", "distill"]);
    expect(sources.map((source) => source.id)).toEqual(["stored", "distill"]);
  });

  test("returns empty prompt when no sources produce entries", async () => {
    const registry = createMemoryRegistry([mockSource("empty", [])]);
    const result = await registry.load({}, 1000);
    expect(result.prompt).toBe("");
    expect(result.tokenEstimate).toBe(0);
  });

  test("fills budget in source order", async () => {
    const registry = createMemoryRegistry([
      mockSource("first", ["alpha", "beta"]),
      mockSource("second", ["gamma"]),
    ]);
    const result = await registry.load({}, 10_000);
    expect(result.prompt).toContain("- alpha");
    expect(result.prompt).toContain("- beta");
    expect(result.prompt).toContain("- gamma");
    expect(result.prompt.startsWith("Memory context:")).toBe(true);
  });

  test("respects token budget and truncates", async () => {
    const longEntry = "x".repeat(400);
    const registry = createMemoryRegistry([mockSource("big", [longEntry, "short"])]);
    const result = await registry.load({}, 50);
    expect(result.prompt).not.toContain(longEntry);
    expect(result.prompt).toContain("short");
  });

  test("first source gets priority over second", async () => {
    const registry = createMemoryRegistry([
      mockSource("high", ["important fact"]),
      mockSource("low", ["less important"]),
    ]);
    const result = await registry.load({}, 4);
    expect(result.prompt).toContain("important fact");
    expect(result.prompt).not.toContain("less important");
  });

  test("commit runs committed sources in order", async () => {
    const calls: string[] = [];
    const registry = createMemoryRegistry([
      mockSource("stored", []),
      mockSource("distill-a", [], () => {
        calls.push("distill-a");
      }),
      mockSource("distill-b", [], () => {
        calls.push("distill-b");
      }),
    ]);
    await registry.commit({ messages: [], output: "done" });
    expect(calls).toEqual(["distill-a", "distill-b"]);
  });

  test("load uses injected selection strategy", async () => {
    const registry = createMemoryRegistry(
      [mockSource("stored", ["first", "second"])],
      async (sources, ctx) => {
        const entries = await Promise.all(sources.map((source) => source.load(ctx)));
        return entries.flatMap((contents, index) =>
          contents.map((content) => ({ sourceId: sources[index].id, content, tokenEstimate: 1 })),
        );
      },
      (entries) => ({ entries: [entries[1]], tokenEstimate: entries[1].tokenEstimate }),
    );
    const result = await registry.load({}, 10_000);
    expect(result.prompt).toContain("second");
    expect(result.prompt).not.toContain("first");
  });

  test("load uses injected normalization strategy", async () => {
    const registry = createMemoryRegistry(
      [mockSource("stored", ["ignored"])],
      async () => [{ sourceId: "custom", content: "normalized", tokenEstimate: 2 }],
    );
    const result = await registry.load({}, 10_000);
    expect(result.prompt).toContain("normalized");
    expect(result.prompt).not.toContain("ignored");
  });
});
