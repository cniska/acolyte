import { extractReadPaths, normalizePath } from "./tool-arg-paths";

export type CacheEntry = {
  result: unknown;
};

export type ToolCache = {
  get(toolName: string, args: Record<string, unknown>): CacheEntry | undefined;
  set(toolName: string, args: Record<string, unknown>, entry: CacheEntry): void;
  invalidateForWrite(toolName: string, args: Record<string, unknown>): void;
  clear(): void;
  stats(): { hits: number; misses: number; invalidations: number; evictions: number; size: number };
};

const CACHEABLE_TOOLS = new Set(["read-file", "find-files", "search-files", "scan-code"]);

export function isCacheableTool(toolName: string): boolean {
  return CACHEABLE_TOOLS.has(toolName);
}

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

export function createToolCache(maxEntries = DEFAULT_MAX_ENTRIES): ToolCache {
  const cache = new Map<string, CacheEntry>();
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

  return {
    get(toolName, args) {
      if (!isCacheableTool(toolName)) return undefined;
      const key = stableKey(toolName, args);
      const entry = cache.get(key);
      if (entry) {
        // Move to end for LRU ordering
        cache.delete(key);
        cache.set(key, entry);
        hits += 1;
        return entry;
      }
      misses += 1;
      return undefined;
    },

    set(toolName, args, entry) {
      if (!isCacheableTool(toolName)) return;
      const key = stableKey(toolName, args);
      if (cache.has(key)) cache.delete(key);
      else if (cache.size >= maxEntries) evictOldest();
      cache.set(key, entry);
      const paths = extractCachedPaths(toolName, args);
      if (paths.length > 0) keyPaths.set(key, paths);
    },

    invalidateForWrite(toolName, args) {
      if (toolName === "run-command") {
        const removed = cache.size;
        cache.clear();
        keyPaths.clear();
        invalidations += removed;
        return;
      }
      const writtenPaths = extractWrittenPaths(toolName, args);
      if (writtenPaths.length === 0) return;
      const writtenSet = new Set(writtenPaths);
      for (const [key, paths] of keyPaths.entries()) {
        if (paths.some((p) => writtenSet.has(p))) {
          cache.delete(key);
          keyPaths.delete(key);
          invalidations += 1;
        }
      }
      // Also invalidate search/find entries since they may reference written files
      const toEvict: string[] = [];
      for (const key of cache.keys()) {
        if (key.startsWith("find-files:") || key.startsWith("search-files:")) {
          toEvict.push(key);
        }
      }
      for (const key of toEvict) {
        cache.delete(key);
        keyPaths.delete(key);
        invalidations += 1;
      }
    },

    clear() {
      cache.clear();
      keyPaths.clear();
    },

    stats() {
      return { hits, misses, invalidations, evictions, size: cache.size };
    },
  };
}
