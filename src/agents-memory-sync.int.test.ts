import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncAgentsMdToProjectMemory } from "./agents-memory-sync";
import { createSqliteMemoryStore } from "./memory-store";
import { projectResourceIdForLabel } from "./resource-id";
import { tempDb, tempDir, writeGitOrigin } from "./test-utils";

const { create: createStore, cleanup: cleanupStores } = tempDb("acolyte-agents-sync-", createSqliteMemoryStore);
const { createDir, cleanupDirs } = tempDir();
afterEach(() => {
  cleanupStores();
  cleanupDirs();
});

const ORIGIN = "git@github.com:owner/repo.git";
const PROJECT_KEY = projectResourceIdForLabel("owner/repo");

function createRepoWorkspace(): string {
  const workspace = createDir("acolyte-agents-workspace-");
  writeGitOrigin(workspace, ORIGIN);
  return workspace;
}

describe("syncAgentsMdToProjectMemory", () => {
  test("writes deterministic project memory record when AGENTS.md exists", async () => {
    const workspace = createRepoWorkspace();
    writeFileSync(join(workspace, "AGENTS.md"), "Rules.\n", "utf8");
    const store = createStore();

    const result = await syncAgentsMdToProjectMemory({ workspace, store });
    expect(result.kind).toBe("synced");

    const records = await store.list({ scopeKey: PROJECT_KEY, kind: "stored" });
    expect(records.length).toBe(1);
    expect(records[0]?.id).toBe("mem_agentsmd");
    expect(records[0]?.content).toContain("Project rules (AGENTS.md):");
    expect(records[0]?.content).toContain("Rules.");
  });

  test("removes deterministic record when AGENTS.md is missing or empty", async () => {
    const workspace = createRepoWorkspace();
    writeFileSync(join(workspace, "AGENTS.md"), "Rules.\n", "utf8");
    const store = createStore();

    await syncAgentsMdToProjectMemory({ workspace, store });
    rmSync(join(workspace, "AGENTS.md"));

    const removed = await syncAgentsMdToProjectMemory({ workspace, store });
    expect(removed.kind).toBe("removed");

    const records = await store.list({ scopeKey: PROJECT_KEY, kind: "stored" });
    expect(records).toEqual([]);
  });

  test("skips a workspace with no project scope", async () => {
    const workspace = createDir("acolyte-agents-no-remote-");
    writeFileSync(join(workspace, "AGENTS.md"), "Rules.\n", "utf8");
    const store = createStore();

    expect(await syncAgentsMdToProjectMemory({ workspace, store })).toEqual({
      kind: "skipped",
      reason: "no_project_scope",
    });
    expect(await store.list({ kind: "stored" })).toEqual([]);
  });
});
