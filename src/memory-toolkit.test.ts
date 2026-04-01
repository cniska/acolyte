import { afterEach, describe, expect, test } from "bun:test";
import { addMemory } from "./memory-ops";
import { createSqliteMemoryStore } from "./memory-store";
import { searchMemories } from "./memory-toolkit";
import { tempDb } from "./test-utils";

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-toolkit-", createSqliteMemoryStore);
afterEach(cleanupStores);

describe("searchMemories", () => {
  test("returns entries up to the limit", async () => {
    const store = createStore();
    await addMemory("alpha fact", { scope: "user", store });
    await addMemory("beta fact", { scope: "user", store });
    await addMemory("gamma fact", { scope: "user", store });
    const result = await searchMemories("anything", { limit: 2, store });
    expect(result).toHaveLength(2);
  });

  test("returns all entries when limit exceeds count", async () => {
    const store = createStore();
    await addMemory("only fact", { scope: "user", store });
    const result = await searchMemories("only", { limit: 10, store });
    expect(result).toHaveLength(1);
  });

  test("returns empty array for empty store", async () => {
    const store = createStore();
    const result = await searchMemories("query", { store });
    expect(result).toEqual([]);
  });

  test("filters by scope", async () => {
    const store = createStore();
    await addMemory("user preference", { scope: "user", store });
    await addMemory("project convention", { scope: "project", store });
    const userOnly = await searchMemories("anything", { scope: "user", store });
    expect(userOnly).toHaveLength(1);
    expect(userOnly[0]?.content).toBe("user preference");
    const projectOnly = await searchMemories("anything", { scope: "project", store });
    expect(projectOnly).toHaveLength(1);
    expect(projectOnly[0]?.content).toBe("project convention");
  });

  test("scope filter applies before limit", async () => {
    const store = createStore();
    await addMemory("user a", { scope: "user", store });
    await addMemory("user b", { scope: "user", store });
    await addMemory("project a", { scope: "project", store });
    const result = await searchMemories("anything", { scope: "user", limit: 5, store });
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.scopeKey.startsWith("user_")).toBe(true);
    }
  });
});
