import { describe, expect, test } from "bun:test";
import type { MemoryEntry } from "./memory-contract";
import { rankByRelevance } from "./memory-toolkit";

function entry(id: string, content: string, scope: "user" | "project" = "user"): MemoryEntry {
  return { id, content, scope, createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("rankByRelevance", () => {
  test("returns entries up to the limit", async () => {
    const entries = [entry("mem_a", "alpha"), entry("mem_b", "beta"), entry("mem_c", "gamma")];
    const result = await rankByRelevance(entries, "anything", 2);
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(entries.some((e) => e.id === r.id)).toBe(true);
    }
  });

  test("returns all entries when limit exceeds count", async () => {
    const entries = [entry("mem_a", "alpha")];
    const result = await rankByRelevance(entries, "alpha", 10);
    expect(result).toHaveLength(1);
  });

  test("returns empty array for empty input", async () => {
    const result = await rankByRelevance([], "query", 5);
    expect(result).toEqual([]);
  });
});
