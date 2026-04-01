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
    const result = await searchMemories("anything", 2, store);
    expect(result).toHaveLength(2);
  });

  test("returns all entries when limit exceeds count", async () => {
    const store = createStore();
    await addMemory("only fact", { scope: "user", store });
    const result = await searchMemories("only", 10, store);
    expect(result).toHaveLength(1);
  });

  test("returns empty array for empty store", async () => {
    const store = createStore();
    const result = await searchMemories("query", 5, store);
    expect(result).toEqual([]);
  });
});
