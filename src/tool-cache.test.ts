import { describe, expect, test } from "bun:test";
import { createToolCache } from "./tool-cache";

const CACHEABLE = new Set(["file-read", "file-find", "file-search", "code-scan"]);

describe("tool-cache", () => {
  test("isCacheable returns true for read/search tools", () => {
    const cache = createToolCache(CACHEABLE);
    expect(cache.isCacheable("file-read")).toBe(true);
    expect(cache.isCacheable("file-find")).toBe(true);
    expect(cache.isCacheable("file-search")).toBe(true);
    expect(cache.isCacheable("code-scan")).toBe(true);
  });

  test("isCacheable returns false for write/execute tools", () => {
    const cache = createToolCache(CACHEABLE);
    expect(cache.isCacheable("file-edit")).toBe(false);
    expect(cache.isCacheable("file-create")).toBe(false);
    expect(cache.isCacheable("file-delete")).toBe(false);
    expect(cache.isCacheable("shell-run")).toBe(false);
  });

  test("cache miss returns undefined", () => {
    const cache = createToolCache(CACHEABLE);
    expect(cache.get("file-read", { path: "src/foo.ts" })).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });

  test("cache hit returns stored entry", () => {
    const cache = createToolCache(CACHEABLE);
    const args = { path: "src/foo.ts" };
    const entry = { result: { kind: "file-read", output: "file content" } };
    cache.set("file-read", args, entry);
    const hit = cache.get("file-read", args);
    expect(hit).toBe(entry);
    expect(cache.stats().hits).toBe(1);
  });

  test("different args produce cache miss", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("file-read", { path: "src/foo.ts" }, { result: "a" });
    expect(cache.get("file-read", { path: "src/bar.ts" })).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });

  test("stable key ignores object key order", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("file-read", { path: "a.ts", extra: 1 }, { result: "ok" });
    const hit = cache.get("file-read", { extra: 1, path: "a.ts" });
    expect(hit).toBeDefined();
    expect(hit?.result).toBe("ok");
  });

  test("ignores non-cacheable tools", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("file-edit", { path: "a.ts" }, { result: "x" });
    expect(cache.get("file-edit", { path: "a.ts" })).toBeUndefined();
    expect(cache.stats().size).toBe(0);
  });

  test("invalidateForWrite evicts entries with overlapping paths", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("file-read", { path: "src/foo.ts" }, { result: "a" });
    cache.set("file-read", { path: "src/bar.ts" }, { result: "b" });
    cache.invalidateForWrite("file-edit", { path: "src/foo.ts" });
    expect(cache.get("file-read", { path: "src/foo.ts" })).toBeUndefined();
    expect(cache.get("file-read", { path: "src/bar.ts" })).toBeDefined();
    expect(cache.stats().invalidations).toBeGreaterThan(0);
  });

  test("invalidateForWrite clears search/find entries on any write", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("file-search", { pattern: "foo" }, { result: "results" });
    cache.set("file-find", { pattern: "*.ts" }, { result: "files" });
    cache.set("file-read", { path: "src/bar.ts" }, { result: "b" });
    cache.invalidateForWrite("file-edit", { path: "src/other.ts" });
    // search/find evicted
    expect(cache.get("file-search", { pattern: "foo" })).toBeUndefined();
    expect(cache.get("file-find", { pattern: "*.ts" })).toBeUndefined();
    // unrelated file-read kept
    expect(cache.get("file-read", { path: "src/bar.ts" })).toBeDefined();
  });

  test("invalidateForWrite evicts pathless entries even with unextractable write args", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("file-search", { pattern: "foo" }, { result: "results" });
    cache.set("file-read", { path: "src/bar.ts" }, { result: "b" });
    // Unknown write tool with no extractable paths — pathless entries should still be evicted
    cache.invalidateForWrite("file-edit", {});
    expect(cache.get("file-search", { pattern: "foo" })).toBeUndefined();
    expect(cache.get("file-read", { path: "src/bar.ts" })).toBeDefined();
  });

  test("shell-run clears entire cache", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("file-read", { path: "a.ts" }, { result: "a" });
    cache.set("file-search", { pattern: "x" }, { result: "b" });
    cache.invalidateForWrite("shell-run", { cmd: "rm", args: ["-rf", "node_modules"] });
    expect(cache.stats().size).toBe(0);
  });

  test("clear resets all entries without counting as invalidations", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("file-read", { path: "a.ts" }, { result: "a" });
    cache.clear();
    expect(cache.stats().size).toBe(0);
    expect(cache.stats().invalidations).toBe(0);
  });

  test("evicts oldest entry when max entries exceeded", () => {
    const cache = createToolCache(new Set(["file-read"]), 2);
    cache.set("file-read", { path: "a.ts" }, { result: "a" });
    cache.set("file-read", { path: "b.ts" }, { result: "b" });
    cache.set("file-read", { path: "c.ts" }, { result: "c" });
    expect(cache.stats().size).toBe(2);
    expect(cache.stats().evictions).toBe(1);
    // oldest (a.ts) evicted
    expect(cache.get("file-read", { path: "a.ts" })).toBeUndefined();
    expect(cache.get("file-read", { path: "b.ts" })).toBeDefined();
    expect(cache.get("file-read", { path: "c.ts" })).toBeDefined();
  });

  test("LRU access promotes entry and evicts least recently used", () => {
    const cache = createToolCache(new Set(["file-read"]), 2);
    cache.set("file-read", { path: "a.ts" }, { result: "a" });
    cache.set("file-read", { path: "b.ts" }, { result: "b" });
    // access a.ts to promote it
    cache.get("file-read", { path: "a.ts" });
    // insert c.ts — should evict b.ts (now oldest)
    cache.set("file-read", { path: "c.ts" }, { result: "c" });
    expect(cache.get("file-read", { path: "a.ts" })).toBeDefined();
    expect(cache.get("file-read", { path: "b.ts" })).toBeUndefined();
    expect(cache.get("file-read", { path: "c.ts" })).toBeDefined();
  });

  test("stats track hits, misses, and invalidations", () => {
    const cache = createToolCache(CACHEABLE);
    const args = { path: "a.ts" };
    cache.get("file-read", args); // miss
    cache.set("file-read", args, { result: "ok" });
    cache.get("file-read", args); // hit
    cache.get("file-read", args); // hit
    cache.invalidateForWrite("shell-run", {});
    const stats = cache.stats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(2);
    expect(stats.invalidations).toBe(1);
    expect(stats.size).toBe(0);
  });
});
