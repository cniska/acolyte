import { extractReadPaths, normalizePath } from "./tool-arg-paths";
import type { ToolCacheStore } from "./tool-cache-store";
import type { ToolCache, ToolCacheEntry } from "./tool-contract";

function stableKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${stableJSON(args)}`;
}

function stableJSON(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJSON(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function extractWrittenPaths(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === "edit-file" || toolName === "create-file" || toolName === "delete-file") {
    const path = args.path;
    if (typeof path === "string" && path.trim().length > 0) return [normalizePath(path.trim())];
    const paths = args.paths;
    if (Array.isArray(paths)) {
      return paths
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => normalizePath(p.trim()));
    }
  }
  return [];
}

function extractCachedPaths(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === "read-file") return extractReadPaths(args, { normalize: true });
  if (toolName === "scan-code") return extractReadPaths(args, { normalize: true });
  return [];
}

const DEFAULT_MAX_ENTRIES = 256;

export function createToolCache(
  cacheableTools: ReadonlySet<string>,
  maxEntries = DEFAULT_MAX_ENTRIES,
  store?: ToolCacheStore,
): ToolCache {
  const cache = new Map<string, ToolCacheEntry>();
  const keyPaths = new Map<string, string[]>();
  let hits = 0;
  let misses = 0;
  let invalidations = 0;
  let evictions = 0;

  function evictOldest(): void {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
      keyPaths.delete(oldest);
      evictions += 1;
    }
  }

  function deserialize(raw: string): ToolCacheEntry | undefined {
    try {
      return JSON.parse(raw) as ToolCacheEntry;
    } catch {
      return undefined;
    }
  }

  return {
    isCacheable: (toolName: string) => cacheableTools.has(toolName),

    get(toolName, args) {
      if (!cacheableTools.has(toolName)) return undefined;
      const key = stableKey(toolName, args);

      // L1: in-memory
      const entry = cache.get(key);
      if (entry) {
        cache.delete(key);
        cache.set(key, entry);
        hits += 1;
        return entry;
      }

      // L2: SQLite store
      if (store) {
        const raw = store.get(key);
        if (raw) {
          const restored = deserialize(raw);
          if (restored) {
            if (cache.size >= maxEntries) evictOldest();
            cache.set(key, restored);
            hits += 1;
            return restored;
          }
        }
      }

      misses += 1;
      return undefined;
    },

    set(toolName, args, entry) {
      if (!cacheableTools.has(toolName)) return;
      const key = stableKey(toolName, args);
      if (cache.has(key)) {
        cache.delete(key);
        keyPaths.delete(key);
      } else if (cache.size >= maxEntries) {
        evictOldest();
      }
      cache.set(key, entry);
      const paths = extractCachedPaths(toolName, args);
      if (paths.length > 0) keyPaths.set(key, paths);

      // Persist to L2 only for entries with tracked paths.
      // Pathless entries (search/find) are L1-only since they can't be
      // invalidated by targeted writes in L2.
      if (store && paths.length > 0) {
        try {
          store.set(key, JSON.stringify(entry), paths);
        } catch {
          // Non-fatal — L1 cache still works.
        }
      }
    },

    populateSubEntries(toolName, args, result) {
      if (toolName !== "read-file") return;
      const paths = args.paths;
      if (!Array.isArray(paths) || paths.length < 2) return;
      if (typeof result !== "string") return;
      const sections = result.split("\n\nFile: ");
      if (sections.length < 2) return;
      const normalized = [sections[0], ...sections.slice(1).map((s) => `File: ${s}`)];
      for (let i = 0; i < normalized.length && i < paths.length; i++) {
        const entry = paths[i];
        if (!entry || typeof entry !== "object") continue;
        const pathEntry = entry as Record<string, unknown>;
        const p = pathEntry.path;
        if (typeof p !== "string") continue;
        const subArg: Record<string, unknown> = { path: p };
        if (pathEntry.start !== undefined) subArg.start = pathEntry.start;
        if (pathEntry.end !== undefined) subArg.end = pathEntry.end;
        this.set(toolName, { paths: [subArg] }, { result: normalized[i] });
        if (pathEntry.start !== undefined || pathEntry.end !== undefined) {
          const rangelessKey = stableKey(toolName, { paths: [{ path: p }] });
          if (!cache.has(rangelessKey)) {
            this.set(toolName, { paths: [{ path: p }] }, { result: normalized[i] });
          }
        }
      }
    },

    invalidateForWrite(toolName, args) {
      if (toolName === "run-command") {
        const removed = cache.size;
        cache.clear();
        keyPaths.clear();
        invalidations += removed;
        store?.clear();
        return;
      }
      const writtenPaths = extractWrittenPaths(toolName, args);
      if (writtenPaths.length > 0) {
        const writtenSet = new Set(writtenPaths);
        for (const [key, paths] of keyPaths.entries()) {
          if (paths.some((p) => writtenSet.has(p))) {
            cache.delete(key);
            keyPaths.delete(key);
            invalidations += 1;
          }
        }
        store?.invalidateByPath(writtenPaths);
      }
      // Evict entries without tracked paths (search/find) since they may reference written files
      const toEvict: string[] = [];
      for (const key of cache.keys()) {
        if (!keyPaths.has(key)) toEvict.push(key);
      }
      for (const key of toEvict) {
        cache.delete(key);
        invalidations += 1;
      }
    },

    clear() {
      cache.clear();
      keyPaths.clear();
      store?.clear();
    },

    stats() {
      return { hits, misses, invalidations, evictions, size: cache.size };
    },
  };
}
