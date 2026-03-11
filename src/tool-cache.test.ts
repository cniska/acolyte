import { describe, expect, test } from "bun:test";
import { createToolCache } from "./tool-cache";

const CACHEABLE = new Set(["read-file", "find-files", "search-files", "scan-code"]);

describe("tool-cache", () => {
  test("isCacheable returns true for read/search tools", () => {
    const cache = createToolCache(CACHEABLE);
    expect(cache.isCacheable("read-file")).toBe(true);
    expect(cache.isCacheable("find-files")).toBe(true);
    expect(cache.isCacheable("search-files")).toBe(true);
    expect(cache.isCacheable("scan-code")).toBe(true);
  });

  test("isCacheable returns false for write/execute tools", () => {
    const cache = createToolCache(CACHEABLE);
    expect(cache.isCacheable("edit-file")).toBe(false);
    expect(cache.isCacheable("create-file")).toBe(false);
    expect(cache.isCacheable("delete-file")).toBe(false);
    expect(cache.isCacheable("run-command")).toBe(false);
  });

  test("cache miss returns undefined", () => {
    const cache = createToolCache(CACHEABLE);
    expect(cache.get("read-file", { paths: [{ path: "src/foo.ts" }] })).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });

  test("cache hit returns stored entry", () => {
    const cache = createToolCache(CACHEABLE);
    const args = { paths: [{ path: "src/foo.ts" }] };
    const entry = { result: { kind: "read-file", output: "file content" } };
    cache.set("read-file", args, entry);
    const hit = cache.get("read-file", args);
    expect(hit).toBe(entry);
    expect(cache.stats().hits).toBe(1);
  });

  test("different args produce cache miss", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("read-file", { paths: [{ path: "src/foo.ts" }] }, { result: "a" });
    expect(cache.get("read-file", { paths: [{ path: "src/bar.ts" }] })).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });

  test("stable key ignores object key order", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("read-file", { paths: [{ path: "a.ts" }], extra: 1 }, { result: "ok" });
    const hit = cache.get("read-file", { extra: 1, paths: [{ path: "a.ts" }] });
    expect(hit).toBeDefined();
    expect(hit?.result).toBe("ok");
  });

  test("ignores non-cacheable tools", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("edit-file", { path: "a.ts" }, { result: "x" });
    expect(cache.get("edit-file", { path: "a.ts" })).toBeUndefined();
    expect(cache.stats().size).toBe(0);
  });

  test("invalidateForWrite evicts entries with overlapping paths", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("read-file", { paths: [{ path: "src/foo.ts" }] }, { result: "a" });
    cache.set("read-file", { paths: [{ path: "src/bar.ts" }] }, { result: "b" });
    cache.invalidateForWrite("edit-file", { path: "src/foo.ts" });
    expect(cache.get("read-file", { paths: [{ path: "src/foo.ts" }] })).toBeUndefined();
    expect(cache.get("read-file", { paths: [{ path: "src/bar.ts" }] })).toBeDefined();
    expect(cache.stats().invalidations).toBeGreaterThan(0);
  });

  test("invalidateForWrite clears search/find entries on any write", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("search-files", { pattern: "foo" }, { result: "results" });
    cache.set("find-files", { patterns: ["*.ts"] }, { result: "files" });
    cache.set("read-file", { paths: [{ path: "src/bar.ts" }] }, { result: "b" });
    cache.invalidateForWrite("edit-file", { path: "src/other.ts" });
    // search/find evicted
    expect(cache.get("search-files", { pattern: "foo" })).toBeUndefined();
    expect(cache.get("find-files", { patterns: ["*.ts"] })).toBeUndefined();
    // unrelated read-file kept
    expect(cache.get("read-file", { paths: [{ path: "src/bar.ts" }] })).toBeDefined();
  });

  test("invalidateForWrite evicts pathless entries even with unextractable write args", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("search-files", { pattern: "foo" }, { result: "results" });
    cache.set("read-file", { paths: [{ path: "src/bar.ts" }] }, { result: "b" });
    // Unknown write tool with no extractable paths — pathless entries should still be evicted
    cache.invalidateForWrite("edit-file", {});
    expect(cache.get("search-files", { pattern: "foo" })).toBeUndefined();
    expect(cache.get("read-file", { paths: [{ path: "src/bar.ts" }] })).toBeDefined();
  });

  test("run-command clears entire cache", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("read-file", { paths: [{ path: "a.ts" }] }, { result: "a" });
    cache.set("search-files", { pattern: "x" }, { result: "b" });
    cache.invalidateForWrite("run-command", { command: "rm -rf node_modules" });
    expect(cache.stats().size).toBe(0);
  });

  test("clear resets all entries without counting as invalidations", () => {
    const cache = createToolCache(CACHEABLE);
    cache.set("read-file", { paths: [{ path: "a.ts" }] }, { result: "a" });
    cache.clear();
    expect(cache.stats().size).toBe(0);
    expect(cache.stats().invalidations).toBe(0);
  });

  test("write to path in multi-path read invalidates whole entry", () => {
    const cache = createToolCache(CACHEABLE);
    const args = { paths: [{ path: "a.ts" }, { path: "b.ts" }] };
    cache.set("read-file", args, { result: "combined" });
    cache.invalidateForWrite("edit-file", { path: "b.ts" });
    expect(cache.get("read-file", args)).toBeUndefined();
  });

  test("evicts oldest entry when max entries exceeded", () => {
    const cache = createToolCache(new Set(["read-file"]), 2);
    cache.set("read-file", { paths: [{ path: "a.ts" }] }, { result: "a" });
    cache.set("read-file", { paths: [{ path: "b.ts" }] }, { result: "b" });
    cache.set("read-file", { paths: [{ path: "c.ts" }] }, { result: "c" });
    expect(cache.stats().size).toBe(2);
    expect(cache.stats().evictions).toBe(1);
    // oldest (a.ts) evicted
    expect(cache.get("read-file", { paths: [{ path: "a.ts" }] })).toBeUndefined();
    expect(cache.get("read-file", { paths: [{ path: "b.ts" }] })).toBeDefined();
    expect(cache.get("read-file", { paths: [{ path: "c.ts" }] })).toBeDefined();
  });

  test("LRU access promotes entry and evicts least recently used", () => {
    const cache = createToolCache(new Set(["read-file"]), 2);
    cache.set("read-file", { paths: [{ path: "a.ts" }] }, { result: "a" });
    cache.set("read-file", { paths: [{ path: "b.ts" }] }, { result: "b" });
    // access a.ts to promote it
    cache.get("read-file", { paths: [{ path: "a.ts" }] });
    // insert c.ts — should evict b.ts (now oldest)
    cache.set("read-file", { paths: [{ path: "c.ts" }] }, { result: "c" });
    expect(cache.get("read-file", { paths: [{ path: "a.ts" }] })).toBeDefined();
    expect(cache.get("read-file", { paths: [{ path: "b.ts" }] })).toBeUndefined();
    expect(cache.get("read-file", { paths: [{ path: "c.ts" }] })).toBeDefined();
  });

  test("stats track hits, misses, and invalidations", () => {
    const cache = createToolCache(CACHEABLE);
    const args = { paths: [{ path: "a.ts" }] };
    cache.get("read-file", args); // miss
    cache.set("read-file", args, { result: "ok" });
    cache.get("read-file", args); // hit
    cache.get("read-file", args); // hit
    cache.invalidateForWrite("run-command", {});
    const stats = cache.stats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(2);
    expect(stats.invalidations).toBe(1);
    expect(stats.size).toBe(0);
  });
});
