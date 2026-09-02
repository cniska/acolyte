import { normalizeMemoryText } from "./distill-ops";
import { log } from "./log";
import {
  type MemoryArchiveEntry,
  type MemoryArchiveRecord,
  type MemoryDisposition,
  type MemoryDispositionKind,
  type MemoryEntry,
  type MemoryRecord,
  type MemoryScope,
  type MemoryStore,
  memoryDispositionSchema,
  type RemoveMemoryResult,
  scopeFromKey,
} from "./memory-contract";
import { embeddingToBuffer, embedText } from "./memory-embedding";
import { getMemoryStore } from "./memory-store";
import { parseResourceId, projectResourceIdFromWorkspace, type ResourceId } from "./resource-id";
import { createId } from "./short-id";
import { estimateTokens } from "./token-estimate";
import { activeUserResourceId } from "./user-identity";

export interface MemoryOptions {
  scope?: MemoryScope;
  workspace?: string;
  store?: MemoryStore;
}

function scopeKeysForScope(scope: MemoryScope | undefined, workspace?: string): string[] {
  const keys: string[] = [];
  if (!scope || scope === "user") keys.push(activeUserResourceId());
  if (!scope || scope === "project") {
    const projectKey = projectResourceIdFromWorkspace(workspace ?? process.cwd());
    if (projectKey) keys.push(projectKey);
  }
  return keys;
}

function toMemoryEntry(record: {
  id: string;
  scopeKey: string;
  content: string;
  createdAt: string;
  lastRecalledAt?: string | null;
}): MemoryEntry {
  return {
    id: record.id,
    content: record.content,
    createdAt: record.createdAt,
    lastRecalledAt: record.lastRecalledAt ?? null,
    scope: scopeFromKey(record.scopeKey),
  };
}

function toMemoryArchiveEntry(record: MemoryArchiveRecord): MemoryArchiveEntry {
  return { ...toMemoryEntry(record), retiredAt: record.retiredAt, disposition: record.disposition };
}

export async function listMemories(options: MemoryOptions = {}): Promise<MemoryEntry[]> {
  const { scope, workspace } = options;
  const store = options.store ?? (await getMemoryStore());
  const keys = scopeKeysForScope(scope, workspace);
  const entries = [];
  for (const key of keys) {
    const records = await store.list({ scopeKey: key });
    entries.push(...records.map(toMemoryEntry));
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}

export interface AddObservationOptions {
  topic?: string | null;
  store?: MemoryStore;
}

export async function addObservation(
  scopeKey: string,
  content: string,
  options: AddObservationOptions = {},
): Promise<MemoryRecord | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const store = options.store ?? (await getMemoryStore());
  const existing = await store.list({ scopeKey });
  const normalized = normalizeMemoryText(trimmed);
  const duplicate = existing.some((e) => normalizeMemoryText(e.content) === normalized);
  if (duplicate) return null;

  const record: MemoryRecord = {
    id: `mem_${createId()}`,
    scopeKey,
    content: trimmed,
    createdAt: new Date().toISOString(),
    tokenEstimate: estimateTokens(trimmed),
    topic: options.topic ?? null,
  };
  await store.write(record);
  log.debug("memory.observation.written", { id: record.id, scopeKey, topic: record.topic });

  try {
    const vec = await embedText(trimmed);
    if (vec) await store.writeEmbedding(record.id, scopeKey, embeddingToBuffer(vec));
  } catch (error) {
    log.warn("memory.observation.embed_failed", { id: record.id, error: String(error) });
  }
  return record;
}

export type ScopeContext = {
  sessionId?: string;
  workspace?: string;
  resourceId?: ResourceId;
};

export function resolveScopeKey(scope: MemoryScope, ctx: ScopeContext): string | null {
  if (scope === "session") return ctx.sessionId ?? null;
  if (scope === "project") {
    const fromResource = parseResourceId(ctx.resourceId);
    if (fromResource?.startsWith("proj_")) return fromResource;
    return ctx.workspace ? projectResourceIdFromWorkspace(ctx.workspace) : null;
  }
  const fromResource = parseResourceId(ctx.resourceId);
  if (fromResource?.startsWith("user_")) return fromResource;
  return activeUserResourceId();
}

/** The scope a write lands in, or the reason there is none, so a caller cannot store into nowhere. */
export function requireScopeKey(scope: MemoryScope, ctx: ScopeContext): string {
  const scopeKey = resolveScopeKey(scope, ctx);
  if (scopeKey) return scopeKey;
  throw new Error(
    scope === "project"
      ? "This workspace has no git remote, so it has no project memory"
      : `Cannot resolve scope key for scope "${scope}"`,
  );
}

export function visibleScopeKeys(ctx: ScopeContext): Set<string> {
  const keys = new Set<string>();
  for (const scope of ["session", "project", "user"] as const) {
    const key = resolveScopeKey(scope, ctx);
    if (key) keys.add(key);
  }
  return keys;
}

export async function removeMemory(id: string, options: MemoryOptions = {}): Promise<RemoveMemoryResult> {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("Memory id cannot be empty");

  const { scope, workspace } = options;
  const store = options.store ?? (await getMemoryStore());
  const keys = scopeKeysForScope(scope, workspace);
  for (const key of keys) {
    const records = await store.list({ scopeKey: key });
    const record = records.find((r) => r.id === trimmed);
    if (record) {
      const entry = toMemoryEntry(record);
      await store.remove(entry.id);
      log.debug("memory.removed", { id: entry.id, scope: entry.scope });
      return { kind: "removed", entry };
    }
  }
  return { kind: "not_found", id: trimmed };
}

export async function retireMemories(
  ids: readonly string[],
  disposition: MemoryDisposition,
  options: MemoryOptions = {},
): Promise<readonly string[]> {
  const trimmed = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (trimmed.length === 0) return [];

  const validated = memoryDispositionSchema.parse(disposition);
  const store = options.store ?? (await getMemoryStore());
  const retired = await store.retire(trimmed, validated);
  log.debug("memory.retire", { ids: retired.join(" "), count: retired.length, disposition: disposition.kind });
  return retired;
}

export async function listArchivedMemories(
  options: MemoryOptions & { disposition?: MemoryDispositionKind } = {},
): Promise<MemoryArchiveEntry[]> {
  const { scope, workspace, disposition } = options;
  const store = options.store ?? (await getMemoryStore());
  const keys = scopeKeysForScope(scope, workspace);
  const entries: MemoryArchiveEntry[] = [];
  for (const key of keys) {
    const records = await store.listArchive({ scopeKey: key, disposition });
    entries.push(...records.map(toMemoryArchiveEntry));
  }
  entries.sort((a, b) => b.retiredAt.localeCompare(a.retiredAt));
  return entries;
}

export async function restoreMemories(
  ids: readonly string[],
  options: MemoryOptions = {},
): Promise<readonly MemoryEntry[]> {
  const trimmed = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (trimmed.length === 0) return [];

  const store = options.store ?? (await getMemoryStore());
  const restored = await store.restore(trimmed);
  log.debug("memory.restore", { ids: restored.map((record) => record.id).join(" "), count: restored.length });

  // Retirement drops the embedding, so a restored record is unrecallable until it is re-embedded.
  for (const record of restored) {
    try {
      const vec = await embedText(record.content);
      if (vec) await store.writeEmbedding(record.id, record.scopeKey, embeddingToBuffer(vec));
    } catch (error) {
      log.warn("memory.restore.embed_failed", { id: record.id, error: String(error) });
    }
  }
  return restored.map(toMemoryEntry);
}

// The CLI runs in the workspace the user is asking about, so its working directory is that workspace.
export const fileMemoryStore = {
  list: (scope?: MemoryScope) => listMemories({ scope, workspace: process.cwd() }),
  remove: (id: string, scope?: MemoryScope) => removeMemory(id, { scope, workspace: process.cwd() }),
  listArchived: (scope?: MemoryScope) => listArchivedMemories({ scope, workspace: process.cwd() }),
  restore: (ids: readonly string[]) => restoreMemories(ids),
};
