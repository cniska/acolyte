import { estimateTokens } from "./agent-input";
import type { MemoryEntry, MemoryScope, MemoryStore, RemoveMemoryResult } from "./memory-contract";
import { embeddingToBuffer, embedText } from "./memory-embedding";
import { createSqliteMemoryStore } from "./memory-store";
import { defaultUserResourceId, projectResourceIdFromWorkspace } from "./resource-id";
import { createId } from "./short-id";

export type { MemoryEntry, MemoryScope, RemoveMemoryResult } from "./memory-contract";

export interface MemoryOptions {
  scope?: MemoryScope | "all";
  workspace?: string;
  store?: MemoryStore;
}

let defaultStore: MemoryStore | null = null;

function getDefaultStore(): MemoryStore {
  if (!defaultStore) {
    defaultStore = createSqliteMemoryStore();
    process.on("exit", () => defaultStore?.close());
  }
  return defaultStore;
}

function scopeKeysForScope(scope: MemoryScope | "all", workspace?: string): string[] {
  const keys: string[] = [];
  if (scope === "all" || scope === "user") keys.push(defaultUserResourceId());
  if (scope === "all" || scope === "project") {
    const ws = workspace ?? process.cwd();
    keys.push(projectResourceIdFromWorkspace(ws));
  }
  return keys;
}

function scopeFromKey(key: string): MemoryScope {
  return key.startsWith("proj_") ? "project" : "user";
}

function toMemoryEntry(record: { id: string; sessionId: string; content: string; createdAt: string }): MemoryEntry {
  return {
    id: record.id,
    content: record.content,
    createdAt: record.createdAt,
    scope: scopeFromKey(record.sessionId),
  };
}

export async function listMemories(options: MemoryOptions = {}): Promise<MemoryEntry[]> {
  const { scope = "all", workspace, store = getDefaultStore() } = options;
  const keys = scopeKeysForScope(scope, workspace);
  const entries = [];
  for (const key of keys) {
    const records = await store.list({ scope: key, kind: "stored" });
    entries.push(...records.map(toMemoryEntry));
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}

export async function addMemory(
  content: string,
  options: Omit<MemoryOptions, "scope"> & { scope?: MemoryScope } = {},
): Promise<MemoryEntry> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Memory content cannot be empty");

  const { scope = "user", workspace, store = getDefaultStore() } = options;
  const scopeKey =
    scope === "project" ? projectResourceIdFromWorkspace(workspace ?? process.cwd()) : defaultUserResourceId();

  const record = {
    id: `mem_${createId()}`,
    sessionId: scopeKey,
    kind: "stored" as const,
    content: trimmed,
    createdAt: new Date().toISOString(),
    tokenEstimate: estimateTokens(trimmed),
  };
  await store.write(record, scope);

  embedText(trimmed)
    .then((vec) => {
      if (vec) store.writeEmbedding(record.id, scopeKey, embeddingToBuffer(vec));
    })
    .catch(() => {});

  return toMemoryEntry(record);
}

export async function removeMemoryByPrefix(
  prefix: string,
  options: Omit<MemoryOptions, "scope"> & { scope?: MemoryScope | "all" } = {},
): Promise<RemoveMemoryResult> {
  const trimmed = prefix.trim();
  if (!trimmed) throw new Error("Memory prefix cannot be empty");

  const entries = await listMemories(options);
  const matches = entries.filter((entry) => entry.id.startsWith(trimmed));
  if (matches.length === 0) return { kind: "not_found", prefix: trimmed };
  if (matches.length > 1) return { kind: "ambiguous", prefix: trimmed, matches };

  const entry = matches[0];
  const { store = getDefaultStore() } = options;
  await store.remove(entry.id);
  return { kind: "removed", entry };
}

export const fileMemoryStore = {
  list: (scope?: MemoryScope | "all") => listMemories({ scope: scope ?? "all" }),
  add: (content: string, scope?: MemoryScope) => addMemory(content, { scope }),
  remove: (prefix: string, scope?: MemoryScope | "all") => removeMemoryByPrefix(prefix, { scope }),
};
