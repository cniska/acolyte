import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "./agent-input";
import { log } from "./log";
import type { MemoryStore } from "./memory-contract";
import { getMemoryStore } from "./memory-store";
import { projectResourceIdFromWorkspace } from "./resource-id";

export const AGENTS_MD_MEMORY_ID = "mem_agentsmd";

type SyncResult = { kind: "synced" } | { kind: "removed" } | { kind: "skipped"; reason: string };

const lastSyncedPromptByWorkspace = new Map<string, string>();

function agentsPromptFromWorkspace(workspace: string): { kind: "present"; prompt: string } | { kind: "absent" } {
  const agentsPath = join(workspace, "AGENTS.md");
  if (!existsSync(agentsPath)) return { kind: "absent" };
  try {
    const content = readFileSync(agentsPath, "utf8").trim();
    if (content.length === 0) return { kind: "absent" };
    return { kind: "present", prompt: ["Project rules (AGENTS.md):", content].join("\n") };
  } catch {
    return { kind: "absent" };
  }
}

/**
 * Best-effort sync between `AGENTS.md` and a deterministic project-scoped memory record.
 *
 * This is intentionally non-throwing: a broken/unreadable AGENTS.md should never prevent the app from starting.
 */
export async function syncAgentsMdToProjectMemory(options: {
  workspace: string;
  store?: MemoryStore;
}): Promise<SyncResult> {
  const { workspace } = options;
  const store = options.store ?? (await getMemoryStore());
  const snapshot = agentsPromptFromWorkspace(workspace);
  if (snapshot.kind === "absent") {
    if (lastSyncedPromptByWorkspace.has(workspace)) lastSyncedPromptByWorkspace.delete(workspace);
    try {
      await store.remove(AGENTS_MD_MEMORY_ID);
      return { kind: "removed" };
    } catch (error) {
      log.warn("agents.memory.sync.remove_failed", { error: String(error) });
      return { kind: "skipped", reason: "remove_failed" };
    }
  }

  const prev = lastSyncedPromptByWorkspace.get(workspace);
  if (prev === snapshot.prompt) return { kind: "skipped", reason: "unchanged" };

  try {
    const scopeKey = projectResourceIdFromWorkspace(workspace);
    await store.write(
      {
        id: AGENTS_MD_MEMORY_ID,
        scopeKey,
        kind: "stored",
        content: snapshot.prompt,
        createdAt: new Date().toISOString(),
        tokenEstimate: estimateTokens(snapshot.prompt),
        lastRecalledAt: null,
      },
      "project",
    );
    lastSyncedPromptByWorkspace.set(workspace, snapshot.prompt);
    return { kind: "synced" };
  } catch (error) {
    log.warn("agents.memory.sync.write_failed", { error: String(error) });
    return { kind: "skipped", reason: "write_failed" };
  }
}
