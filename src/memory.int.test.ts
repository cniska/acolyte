import { afterEach, describe, expect, test } from "bun:test";
import { addMemory, listMemories, removeMemory } from "./memory-ops";
import { createSqliteMemoryStore } from "./memory-store";
import { tempDb } from "./test-utils";

const { create: createDb, cleanup } = tempDb("acolyte-memory-", createSqliteMemoryStore);
afterEach(cleanup);

describe("sqlite memory store", () => {
  test("adds user memory and retrieves it", async () => {
    const db = createDb();
    const entry = await addMemory("Prefer concise answers", { scope: "user", store: db });

    expect(entry.id).toMatch(/^mem_/);
    expect(entry.content).toBe("Prefer concise answers");
    expect(entry.scope).toBe("user");
  });

  test("supports separate project and user memories", async () => {
    const db = createDb();
    await addMemory("Global preference", { scope: "user", store: db });
    await addMemory("Project convention", { scope: "project", store: db });

    const projectOnly = await listMemories({ scope: "project", store: db });
    const userOnly = await listMemories({ scope: "user", store: db });
    const all = await listMemories({ store: db });

    expect(projectOnly).toHaveLength(1);
    expect(projectOnly[0]?.scope).toBe("project");
    expect(userOnly).toHaveLength(1);
    expect(userOnly[0]?.scope).toBe("user");
    expect(all).toHaveLength(2);
    expect(all.some((entry) => entry.scope === "project")).toBe(true);
    expect(all.some((entry) => entry.scope === "user")).toBe(true);
  });

  test("removeMemory removes a matching memory", async () => {
    const db = createDb();
    const entry = await addMemory("Disposable note", { scope: "user", store: db });
    const result = await removeMemory(entry.id, { store: db });
    expect(result.kind).toBe("removed");
    const all = await listMemories({ store: db });
    expect(all.some((item) => item.id === entry.id)).toBe(false);
  });

  test("removeMemory returns not_found for unknown id", async () => {
    const db = createDb();
    const result = await removeMemory("mem_missing", { store: db });
    expect(result).toEqual({ kind: "not_found", id: "mem_missing" });
  });
});
