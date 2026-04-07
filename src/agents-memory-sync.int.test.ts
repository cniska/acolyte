import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncAgentsMdToProjectMemory } from "./agents-memory-sync";
import { createSqliteMemoryStore } from "./memory-store";
import { projectResourceIdFromWorkspace } from "./resource-id";
import { tempDb, tempDir } from "./test-utils";

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-agents-sync-", createSqliteMemoryStore);
const { createDir, cleanupDirs } = tempDir();
afterEach(() => {
  cleanupStores();
  cleanupDirs();
});

describe("syncAgentsMdToProjectMemory", () => {
  test("writes deterministic project memory record when AGENTS.md exists", async () => {
    const workspace = createDir("acolyte-agents-workspace-");
    writeFileSync(join(workspace, "AGENTS.md"), "Rules.\n", "utf8");
    const store = createStore();

    const result = await syncAgentsMdToProjectMemory({ workspace, store });
    expect(result.kind).toBe("synced");

    const scopeKey = projectResourceIdFromWorkspace(workspace);
    const records = await store.list({ scopeKey, kind: "stored" });
    expect(records.length).toBe(1);
    expect(records[0]?.id).toBe("mem_agentsmd");
    expect(records[0]?.content).toContain("Project rules (AGENTS.md):");
    expect(records[0]?.content).toContain("Rules.");
  });

  test("removes deterministic record when AGENTS.md is missing or empty", async () => {
    const workspace = createDir("acolyte-agents-workspace-");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), "Rules.\n", "utf8");
    const store = createStore();

    await syncAgentsMdToProjectMemory({ workspace, store });
    rmSync(join(workspace, "AGENTS.md"));

    const removed = await syncAgentsMdToProjectMemory({ workspace, store });
    expect(removed.kind).toBe("removed");

    const scopeKey = projectResourceIdFromWorkspace(workspace);
    const records = await store.list({ scopeKey, kind: "stored" });
    expect(records).toEqual([]);
  });
});
