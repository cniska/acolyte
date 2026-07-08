import { estimateTokens } from "./agent-input";
import { normalizeMemoryText } from "./distill-ops";
import { log } from "./log";
import {
  type MemoryEntry,
  type MemoryKind,
  type MemoryRecord,
  type MemoryScope,
  type MemoryStore,
  type RemoveMemoryResult,
  scopeFromKey,
} from "./memory-contract";
import { embeddingToBuffer, embedText } from "./memory-embedding";
import { getMemoryStore } from "./memory-store";
import { defaultUserResourceId, parseResourceId, projectResourceIdFromWorkspace, type ResourceId } from "./resource-id";
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

function toMemoryEntry(record: {
  id: string;
  kind: MemoryKind;
  scopeKey: string;
  content: string;
  createdAt: string;
  lastRecalledAt?: string | null;
}): MemoryEntry {
  return {
    id: record.id,
    kind: record.kind,
    content: record.content,
    createdAt: record.createdAt,
    lastRecalledAt: record.lastRecalledAt ?? null,
    scope: scopeFromKey(record.scopeKey),
  };
}

export async function listMemories(options: MemoryOptions = {}): Promise<MemoryEntry[]> {
  const { scope, workspace } = options;
  const store = options.store ?? (await getMemoryStore());
  const keys = scopeKeysForScope(scope, workspace);
  const entries = [];
  for (const key of keys) {
    // List all kinds so distilled observations appear, not only stored memories.
    const records = await store.list({ scopeKey: key });
    entries.push(...records.map(toMemoryEntry));
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}

export interface AddMemoryOptions {
  scope?: MemoryScope;
  workspace?: string;
  sessionId?: string;
  resourceId?: ResourceId;
  store?: MemoryStore;
}

export async function addMemory(content: string, options: AddMemoryOptions = {}): Promise<MemoryEntry> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Memory content cannot be empty");

  const { scope = "user", workspace, sessionId, resourceId } = options;
  const store = options.store ?? (await getMemoryStore());
  const scopeKey = resolveScopeKey(scope, { sessionId, workspace, resourceId });
  if (!scopeKey) throw new Error(`Cannot resolve scope key for scope "${scope}"`);

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

  try {
    const vec = await embedText(trimmed);
    if (vec) await store.writeEmbedding(record.id, scopeKey, embeddingToBuffer(vec));
  } catch (error) {
    log.warn("memory.stored.embed_failed", { id: record.id, error: String(error) });
  }

  return toMemoryEntry(record);
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
  const latest = existing.filter((e) => e.kind === "observation").slice(-1)[0];
  if (latest && normalizeMemoryText(latest.content) === normalizeMemoryText(trimmed)) return null;

  const record: MemoryRecord = {
    id: `mem_${createId()}`,
    scopeKey,
    kind: "observation",
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

export function resolveScopeKey(
  scope: MemoryScope,
  ctx: ScopeContext,
  options: { strict?: boolean } = {},
): string | null {
  if (scope === "session") return ctx.sessionId ?? null;
  if (scope === "project") {
    const fromResource = parseResourceId(ctx.resourceId);
    if (fromResource?.startsWith("proj_")) return fromResource;
    if (ctx.workspace) return projectResourceIdFromWorkspace(ctx.workspace);
    return options.strict ? null : projectResourceIdFromWorkspace(process.cwd());
  }
  const fromResource = parseResourceId(ctx.resourceId);
  if (fromResource?.startsWith("user_")) return fromResource;
  return defaultUserResourceId();
}

export function visibleScopeKeys(ctx: ScopeContext): Set<string> {
  const keys = new Set<string>();
  for (const scope of ["session", "project", "user"] as const) {
    const key = resolveScopeKey(scope, ctx, { strict: true });
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
    // Match all kinds so distilled observations are removable, not only stored memories.
    const records = await store.list({ scopeKey: key });
    const record = records.find((r) => r.id === trimmed);
    if (record) {
      const entry = toMemoryEntry(record);
      await store.remove(entry.id);
      log.debug("memory.removed", { id: entry.id, kind: entry.kind, scope: entry.scope });
      return { kind: "removed", entry };
    }
  }
  return { kind: "not_found", id: trimmed };
}

export const fileMemoryStore = {
  list: (scope?: MemoryScope) => listMemories({ scope }),
  add: (content: string, scope?: MemoryScope) => addMemory(content, { scope }),
  remove: (id: string, scope?: MemoryScope) => removeMemory(id, { scope }),
};
