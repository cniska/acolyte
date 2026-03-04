import { describe, expect, test } from "bun:test";
import type { MemoryCommitContext, MemoryLoadContext, MemorySource } from "./memory-contract";

function createMockSource(id: string, entries: string[], commitFn?: (ctx: MemoryCommitContext) => void): MemorySource {
  return {
    id,
    async load() {
      return entries;
    },
    commit: commitFn ? async (ctx) => commitFn(ctx) : undefined,
  };
}

async function loadWithSources(
  sources: MemorySource[],
  ctx: MemoryLoadContext,
  budgetTokens: number,
): Promise<{ prompt: string; tokenEstimate: number }> {
  const { estimateTokens } = await import("./agent-input");
  const parts: string[] = [];
  let used = 0;
  for (const source of sources) {
    const entries = await source.load(ctx);
    for (const entry of entries) {
      const cost = estimateTokens(entry);
      if (used + cost > budgetTokens) break;
      parts.push(entry);
      used += cost;
    }
  }
  if (parts.length === 0) return { prompt: "", tokenEstimate: 0 };
  return {
    prompt: `Memory context:\n${parts.map((p) => `- ${p}`).join("\n")}`,
    tokenEstimate: used,
  };
}

describe("memory registry", () => {
  test("returns empty prompt when no sources produce entries", async () => {
    const sources = [createMockSource("empty", [])];
    const result = await loadWithSources(sources, {}, 1000);
    expect(result.prompt).toBe("");
    expect(result.tokenEstimate).toBe(0);
  });

  test("fills budget in source order", async () => {
    const sources = [createMockSource("first", ["alpha", "beta"]), createMockSource("second", ["gamma"])];
    const result = await loadWithSources(sources, {}, 10_000);
    expect(result.prompt).toContain("- alpha");
    expect(result.prompt).toContain("- beta");
    expect(result.prompt).toContain("- gamma");
    expect(result.prompt.startsWith("Memory context:")).toBe(true);
  });

  test("respects token budget and truncates", async () => {
    const longEntry = "x".repeat(400);
    const sources = [createMockSource("big", [longEntry, "short"])];
    const result = await loadWithSources(sources, {}, 50);
    expect(result.prompt).not.toContain(longEntry);
  });

  test("first source gets priority over second", async () => {
    const sources = [
      createMockSource("high", ["important fact"]),
      createMockSource("low", ["less important"]),
    ];
    const result = await loadWithSources(sources, {}, 4);
    expect(result.prompt).toContain("important fact");
    expect(result.prompt).not.toContain("less important");
  });
});
