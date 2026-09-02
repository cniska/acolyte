import { afterEach, describe, expect, test } from "bun:test";
import { addObservation, listMemories, removeMemory, requireScopeKey } from "./memory-ops";
import { createSqliteMemoryStore } from "./memory-store";
import { tempDb, tempDir, writeGitOrigin } from "./test-utils";

const { create: createDb, cleanup } = tempDb("acolyte-memory-", createSqliteMemoryStore);
const { createDir, cleanupDirs } = tempDir();
afterEach(() => {
  cleanup();
  cleanupDirs();
});

function createRepoWorkspace(): string {
  const workspace = createDir("acolyte-memory-workspace-");
  writeGitOrigin(workspace, "git@github.com:owner/repo.git");
  return workspace;
}

describe("sqlite memory store", () => {
  test("adds user memory and retrieves it", async () => {
    const db = createDb();
    await addObservation(requireScopeKey("user", {}), "Prefer concise answers", { store: db });

    const [entry] = await listMemories({ scope: "user", store: db });
    expect(entry?.id).toMatch(/^mem_/);
    expect(entry?.content).toBe("Prefer concise answers");
    expect(entry?.scope).toBe("user");
  });

  test("supports separate project and user memories", async () => {
    const db = createDb();
    const workspace = createRepoWorkspace();
    await addObservation(requireScopeKey("user", {}), "Global preference", { store: db });
    await addObservation(requireScopeKey("project", { workspace }), "Project convention", { store: db });

    const projectOnly = await listMemories({ scope: "project", workspace, store: db });
    const userOnly = await listMemories({ scope: "user", store: db });
    const all = await listMemories({ workspace, store: db });

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
    const added = await addObservation(requireScopeKey("user", {}), "Disposable note", { store: db });
    expect(added).not.toBeNull();
    const id = added?.id ?? "";
    const result = await removeMemory(id, { store: db });
    expect(result.kind).toBe("removed");
    const all = await listMemories({ store: db });
    expect(all.some((item) => item.id === id)).toBe(false);
  });

  test("removeMemory returns not_found for unknown id", async () => {
    const db = createDb();
    const result = await removeMemory("mem_missing", { store: db });
    expect(result).toEqual({ kind: "not_found", id: "mem_missing" });
  });

  test("removeMemory removes a distilled observation and its embedding", async () => {
    const db = createDb();
    const record = await addObservation("user_local", "Prefers tabs over spaces", { store: db });
    expect(record).not.toBeNull();
    const id = record?.id ?? "";
    await db.writeEmbedding(id, "user_local", Buffer.from([1, 2, 3, 4]));

    const result = await removeMemory(id, { store: db });
    expect(result.kind).toBe("removed");

    const all = await listMemories({ store: db });
    expect(all.some((item) => item.id === id)).toBe(false);
    expect(await db.getEmbedding(id)).toBeNull();
  });
});
