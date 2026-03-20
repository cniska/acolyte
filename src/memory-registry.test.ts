import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setTokenEncoder } from "./agent-input";
import { createMemoryRegistry, resolveMemorySources } from "./memory-registry";
import { createMemorySource } from "./test-utils";

// Use a deterministic chars/4 estimator so budget tests don't depend on the tiktoken encoding.
beforeAll(() => setTokenEncoder({ encode: (input: string) => ({ length: Math.ceil(input.length / 4) }) }));
afterAll(() => setTokenEncoder(null));

describe("memory registry", () => {
  test("resolveMemorySources preserves configured order", () => {
    const sources = resolveMemorySources(["distill_session", "stored"]);
    expect(sources.map((source) => source.id)).toEqual(["distill_session", "stored"]);
  });

  test("resolveMemorySources deduplicates repeated source ids", () => {
    const sources = resolveMemorySources(["stored", "stored", "distill_session"]);
    expect(sources.map((source) => source.id)).toEqual(["stored", "distill_session"]);
  });

  test("returns empty prompt when no sources produce entries", async () => {
    const registry = createMemoryRegistry([createMemorySource("empty", [])]);
    const result = await registry.load({}, 1000);
    expect(result.prompt).toBe("");
    expect(result.tokenEstimate).toBe(0);
    expect(result.entryCount).toBe(0);
    expect(result.continuationSelected).toBe(false);
    expect(result.continuation).toEqual({});
  });

  test("fills budget in source order", async () => {
    const registry = createMemoryRegistry([
      createMemorySource("first", ["alpha", "beta"]),
      createMemorySource("second", ["gamma"]),
    ]);
    const result = await registry.load({}, 10_000);
    expect(result.prompt).toContain("- alpha");
    expect(result.prompt).toContain("- beta");
    expect(result.prompt).toContain("- gamma");
    expect(result.prompt.startsWith("Memory context:")).toBe(true);
  });

  test("respects token budget and truncates", async () => {
    const longEntry = "x".repeat(400);
    const registry = createMemoryRegistry([createMemorySource("big", [longEntry, "short"])]);
    const result = await registry.load({}, 50);
    expect(result.prompt).not.toContain(longEntry);
    expect(result.prompt).toContain("short");
  });

  test("first source gets priority over second", async () => {
    const registry = createMemoryRegistry([
      createMemorySource("high", ["important fact"]),
      createMemorySource("low", ["less important"]),
    ]);
    const result = await registry.load({}, 4);
    expect(result.prompt).toContain("important fact");
    expect(result.prompt).not.toContain("less important");
  });

  test("commit runs committed sources in order", async () => {
    const calls: string[] = [];
    const registry = createMemoryRegistry([
      createMemorySource("stored", []),
      createMemorySource("distill-a", [], () => {
        calls.push("distill-a");
      }),
      createMemorySource("distill-b", [], () => {
        calls.push("distill-b");
      }),
    ]);
    await registry.commit({ messages: [], output: "done" });
    expect(calls).toEqual(["distill-a", "distill-b"]);
  });

  test("load uses injected selection strategy", async () => {
    const registry = createMemoryRegistry(
      [createMemorySource("stored", ["first", "second"])],
      async (sources, ctx) => {
        const entries = await Promise.all(sources.map((source) => source.loadEntries(ctx)));
        return entries.flatMap((contents, index) =>
          contents.map((entry) => ({ sourceId: sources[index].id, content: entry.content, tokenEstimate: 1 })),
        );
      },
      async (entries) => ({ entries: [entries[1]], tokenEstimate: entries[1].tokenEstimate }),
    );
    const result = await registry.load({}, 10_000);
    expect(result.prompt).toContain("second");
    expect(result.prompt).not.toContain("first");
  });

  test("load uses injected normalization strategy", async () => {
    const registry = createMemoryRegistry([createMemorySource("stored", ["ignored"])], async () => [
      { sourceId: "custom", content: "normalized", tokenEstimate: 2 },
    ]);
    const result = await registry.load({}, 10_000);
    expect(result.prompt).toContain("normalized");
    expect(result.prompt).not.toContain("ignored");
  });

  test("load prioritizes continuation state under tight budget", async () => {
    const registry = createMemoryRegistry(
      [createMemorySource("stored", ["general note"]), createMemorySource("distill", ["Current task: finish memory"])],
      async () => [
        { sourceId: "stored", content: "general note", tokenEstimate: 4 },
        { sourceId: "distill", content: "Current task: finish memory", tokenEstimate: 4, isContinuation: true },
      ],
    );
    const result = await registry.load({}, 4);
    expect(result.prompt).toContain("Current task: finish memory");
    expect(result.prompt).not.toContain("general note");
    expect(result.continuationSelected).toBe(true);
    expect(result.continuation.currentTask).toBe("finish memory");
  });

  test("load prefers most recent continuation over older continuation", async () => {
    const registry = createMemoryRegistry(
      [createMemorySource("stored", ["Current task: old"]), createMemorySource("distill", ["Current task: new"])],
      async () => [
        { sourceId: "stored", content: "Current task: old", tokenEstimate: 4, isContinuation: true },
        { sourceId: "distill", content: "Current task: new", tokenEstimate: 4, isContinuation: true },
      ],
    );
    const result = await registry.load({}, 8);
    expect(result.prompt).toContain("Current task: new");
    expect(result.prompt).not.toContain("Current task: old");
    expect(result.continuation.currentTask).toBe("new");
  });

  test("load falls back to older continuation when freshest does not fit", async () => {
    const registry = createMemoryRegistry(
      [
        createMemorySource("stored", ["Current task: older"]),
        createMemorySource("distill", ["Current task: freshest"]),
      ],
      async () => [
        { sourceId: "stored", content: "Current task: older", tokenEstimate: 4, isContinuation: true },
        { sourceId: "distill", content: "Current task: freshest", tokenEstimate: 8, isContinuation: true },
      ],
    );
    const result = await registry.load({}, 4);
    expect(result.prompt).toContain("Current task: older");
    expect(result.prompt).not.toContain("Current task: freshest");
    expect(result.continuation.currentTask).toBe("older");
  });

  test("load extracts next-step continuation from selected continuation entries", async () => {
    const registry = createMemoryRegistry([createMemorySource("distill", ["Next step: add tests"])], async () => [
      { sourceId: "distill", content: "Next step: add tests", tokenEstimate: 4, isContinuation: true },
    ]);
    const result = await registry.load({}, 8);
    expect(result.continuation.nextStep).toBe("add tests");
  });

  test("load dedupes duplicate entries across sources", async () => {
    const registry = createMemoryRegistry(
      [createMemorySource("stored", ["same"]), createMemorySource("distill", ["same", "different"])],
      async () => [
        { sourceId: "stored", content: "same", tokenEstimate: 2 },
        { sourceId: "distill", content: "same", tokenEstimate: 2 },
        { sourceId: "distill", content: "different", tokenEstimate: 2 },
      ],
    );
    const result = await registry.load({}, 20);
    expect(result.prompt).toContain("- same");
    expect(result.prompt).toContain("- different");
    expect((result.prompt.match(/- same/g) ?? []).length).toBe(1);
  });

  test("load ignores blank entries from sources", async () => {
    const registry = createMemoryRegistry([createMemorySource("stored", ["", " ", "kept"])]);
    const result = await registry.load({}, 20);
    expect(result.prompt).toContain("- kept");
    expect(result.prompt).not.toContain("-  ");
  });
});
