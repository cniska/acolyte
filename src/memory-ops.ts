import { estimateTokens } from "./agent-input";
import { log } from "./log";
import {
  type MemoryEntry,
  type MemoryScope,
  type MemoryStore,
  type RemoveMemoryResult,
  scopeFromKey,
} from "./memory-contract";
import { embeddingToBuffer, embedText } from "./memory-embedding";
import { getDefaultMemoryStore } from "./memory-store";
import { defaultUserResourceId, projectResourceIdFromWorkspace } from "./resource-id";
import { createId } from "./short-id";

export type { MemoryEntry, MemoryScope, RemoveMemoryResult } from "./memory-contract";

export interface MemoryOptions {
  scope?: MemoryScope;
  workspace?: string;
  store?: MemoryStore;
}

function scopeKeysForScope(scope: MemoryScope | undefined, workspace?: string): string[] {
  const keys: string[] = [];
  if (!scope || scope === "user") keys.push(defaultUserResourceId());
  if (!scope || scope === "project") {
    const ws = workspace ?? process.cwd();
    keys.push(projectResourceIdFromWorkspace(ws));
  }
  return keys;
}

function toMemoryEntry(record: { id: string; scopeKey: string; content: string; createdAt: string }): MemoryEntry {
  return {
    id: record.id,
    content: record.content,
    createdAt: record.createdAt,
    scope: scopeFromKey(record.scopeKey),
  };
}

export async function listMemories(options: MemoryOptions = {}): Promise<MemoryEntry[]> {
  const { scope, workspace, store = getDefaultMemoryStore() } = options;
  const keys = scopeKeysForScope(scope, workspace);
  const entries = [];
  for (const key of keys) {
    const records = await store.list({ scopeKey: key, kind: "stored" });
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

  const { scope = "user", workspace, store = getDefaultMemoryStore() } = options;
  const scopeKey =
    scope === "project" ? projectResourceIdFromWorkspace(workspace ?? process.cwd()) : defaultUserResourceId();

  const record = {
    id: `mem_${createId()}`,
    scopeKey,
    kind: "stored" as const,
    content: trimmed,
    createdAt: new Date().toISOString(),
    tokenEstimate: estimateTokens(trimmed),
  };
  await store.write(record, scope);
  log.debug("memory.stored.added", { id: record.id, scope, tokens: record.tokenEstimate });

  embedText(trimmed)
    .then((vec) => {
      if (vec) store.writeEmbedding(record.id, scopeKey, embeddingToBuffer(vec));
    })
    .catch((error) => {
      log.warn("memory.stored.embed_failed", { id: record.id, error: String(error) });
    });

  return toMemoryEntry(record);
}

export async function removeMemory(id: string, options: MemoryOptions = {}): Promise<RemoveMemoryResult> {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("Memory id cannot be empty");

  const entries = await listMemories(options);
  const entry = entries.find((e) => e.id === trimmed);
  if (!entry) return { kind: "not_found", id: trimmed };

  const { store = getDefaultMemoryStore() } = options;
  await store.remove(entry.id);
  log.debug("memory.stored.removed", { id: entry.id, scope: entry.scope });
  return { kind: "removed", entry };
}

export const fileMemoryStore = {
  list: (scope?: MemoryScope) => listMemories({ scope }),
  add: (content: string, scope?: MemoryScope) => addMemory(content, { scope }),
  remove: (prefix: string, scope?: MemoryScope) => removeMemory(prefix, { scope }),
};
