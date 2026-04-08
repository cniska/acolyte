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
import { getMemoryStore } from "./memory-store";
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

export async function listMemories(options: MemoryOptions = {}): Promise<MemoryEntry[]> {
  const { scope, workspace } = options;
  const store = options.store ?? (await getMemoryStore());
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

  const { scope = "user", workspace } = options;
  const store = options.store ?? (await getMemoryStore());
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

  try {
    const vec = await embedText(trimmed);
    if (vec) await store.writeEmbedding(record.id, scopeKey, embeddingToBuffer(vec));
  } catch (error) {
    log.warn("memory.stored.embed_failed", { id: record.id, error: String(error) });
  }

  return toMemoryEntry(record);
}

export async function removeMemory(id: string, options: MemoryOptions = {}): Promise<RemoveMemoryResult> {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("Memory id cannot be empty");

  const { scope, workspace } = options;
  const store = options.store ?? (await getMemoryStore());
  const keys = scopeKeysForScope(scope, workspace);
  for (const key of keys) {
    const records = await store.list({ scopeKey: key, kind: "stored" });
    const record = records.find((r) => r.id === trimmed);
    if (record) {
      const entry = toMemoryEntry(record);
      await store.remove(entry.id);
      log.debug("memory.stored.removed", { id: entry.id, scope: entry.scope });
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

export type DistillScope = "session" | "project" | "user";

type ParsedFact = { scope: DistillScope; content: string; topic: string | null };

export type SplitResult = {
  facts: ParsedFact[];
  sessionCount: number;
  projectCount: number;
  userCount: number;
  droppedUntaggedCount: number;
  droppedMalformedCount: number;
};

function stripTrailingSurrogate(s: string): string {
  if (s.length === 0) return s;
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) return s.slice(0, -1);
  return s;
}

const CHARS_PER_TOKEN_ESTIMATE = 4;
const TEXT_SHRINK_RATIO = 0.9;

export function clampToTokenEstimate(content: string, maxTokens: number): string {
  const text = content.trim();
  if (!text) return "";
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  let clamped = stripTrailingSurrogate(text.slice(0, Math.max(1, maxTokens * CHARS_PER_TOKEN_ESTIMATE))).trim();
  while (clamped.length > 0 && estimateTokens(clamped) > maxTokens) {
    clamped = stripTrailingSurrogate(clamped.slice(0, Math.floor(clamped.length * TEXT_SHRINK_RATIO))).trim();
  }
  return clamped;
}

export function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseObserveDirective(line: string): DistillScope | null {
  const match = line.trim().match(/^@observe\s+(project|user|session)$/i);
  return match ? (match[1].toLowerCase() as DistillScope) : null;
}

export function parseTopicDirective(line: string): string | null {
  const match = line.trim().match(/^@topic\s+(\S+)$/i);
  return match ? match[1].toLowerCase() : null;
}

export function hasMalformedObserveDirective(line: string): boolean {
  return /^@observe\b/i.test(line.trim()) && !parseObserveDirective(line);
}

export function splitScopedObservation(observed: string): SplitResult {
  const lines = observed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const facts: ParsedFact[] = [];
  let droppedUntaggedCount = 0;
  let droppedMalformedCount = 0;
  let pendingScope: DistillScope | null = null;
  let pendingTopic: string | null = null;
  for (const line of lines) {
    const scope = parseObserveDirective(line);
    if (scope) {
      pendingScope = scope;
      pendingTopic = null;
      continue;
    }
    if (hasMalformedObserveDirective(line)) {
      droppedMalformedCount += 1;
      pendingScope = null;
      pendingTopic = null;
      continue;
    }
    const topic = parseTopicDirective(line);
    if (topic) {
      pendingTopic = topic;
      continue;
    }
    if (!pendingScope) {
      droppedUntaggedCount += 1;
      continue;
    }
    facts.push({ scope: pendingScope, content: line, topic: pendingTopic });
    pendingScope = null;
    pendingTopic = null;
  }

  return {
    facts,
    sessionCount: facts.filter((f) => f.scope === "session").length,
    projectCount: facts.filter((f) => f.scope === "project").length,
    userCount: facts.filter((f) => f.scope === "user").length,
    droppedUntaggedCount,
    droppedMalformedCount,
  };
}
