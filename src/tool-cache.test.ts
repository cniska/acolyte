import { afterEach, describe, expect, test } from "bun:test";
import { tempDb } from "./test-utils";
import { createToolCache } from "./tool-cache";
import { createToolCacheStore } from "./tool-cache-store";

const CACHEABLE = new Set(["read-file", "find-files", "search-files", "scan-code"]);
const { create: createStore, cleanup } = tempDb("acolyte-cache-l2-", createToolCacheStore);
afterEach(cleanup);

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

  test("populateSubEntries splits multi-file read into per-file cache entries", () => {
    const cache = createToolCache(CACHEABLE);
    const multiArgs = { paths: [{ path: "src/a.ts" }, { path: "src/b.ts" }] };
    const output = "File: /workspace/src/a.ts\n1: const a = 1;\n\nFile: /workspace/src/b.ts\n1: const b = 2;";
    const result = { kind: "read-file", paths: ["src/a.ts", "src/b.ts"], output };
    cache.set("read-file", multiArgs, { result });
    cache.populateSubEntries("read-file", multiArgs, result);
    const hitA = cache.get("read-file", { paths: [{ path: "src/a.ts" }] });
    expect(hitA).toBeDefined();
    expect((hitA?.result as { output: string }).output).toBe("File: /workspace/src/a.ts\n1: const a = 1;");
    const hitB = cache.get("read-file", { paths: [{ path: "src/b.ts" }] });
    expect(hitB).toBeDefined();
    expect((hitB?.result as { output: string }).output).toBe("File: /workspace/src/b.ts\n1: const b = 2;");
  });

  test("populateSubEntries does nothing for single-file reads", () => {
    const cache = createToolCache(CACHEABLE);
    const args = { paths: [{ path: "src/a.ts" }] };
    const result = { kind: "read-file", paths: ["src/a.ts"], output: "File: /workspace/src/a.ts\n1: const a = 1;" };
    cache.set("read-file", args, { result });
    cache.populateSubEntries("read-file", args, result);
    // Only the original entry exists, no extra sub-entries
    expect(cache.stats().size).toBe(1);
  });

  test("write invalidation evicts sub-entry for written file", () => {
    const cache = createToolCache(CACHEABLE);
    const multiArgs = { paths: [{ path: "src/a.ts" }, { path: "src/b.ts" }] };
    const output = "File: /workspace/src/a.ts\n1: const a = 1;\n\nFile: /workspace/src/b.ts\n1: const b = 2;";
    const result = { kind: "read-file", paths: ["src/a.ts", "src/b.ts"], output };
    cache.set("read-file", multiArgs, { result });
    cache.populateSubEntries("read-file", multiArgs, result);
    cache.invalidateForWrite("edit-file", { path: "src/a.ts" });
    // a.ts sub-entry and multi-read entry both evicted
    expect(cache.get("read-file", { paths: [{ path: "src/a.ts" }] })).toBeUndefined();
    expect(cache.get("read-file", multiArgs)).toBeUndefined();
    // b.ts sub-entry survives
    expect(cache.get("read-file", { paths: [{ path: "src/b.ts" }] })).toBeDefined();
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

describe("L2 SQLite integration", () => {
  test("L1 miss falls back to L2 hit", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("read-file", { paths: [{ path: "/a.ts" }] }, { result: "content-a" });

    // New L1 cache, same L2 store — simulates a new task
    const cache2 = createToolCache(CACHEABLE, 256, store);
    const entry = cache2.get("read-file", { paths: [{ path: "/a.ts" }] });
    expect(entry).toBeDefined();
    expect(entry?.result).toBe("content-a");
  });

  test("pathless entries are not persisted to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("search-files", { patterns: ["foo"] }, { result: "found" });

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("search-files", { patterns: ["foo"] })).toBeUndefined();
  });

  test("write invalidation propagates to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("read-file", { paths: [{ path: "/a.ts" }] }, { result: "old" });

    cache1.invalidateForWrite("edit-file", { path: "/a.ts" });

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("read-file", { paths: [{ path: "/a.ts" }] })).toBeUndefined();
  });

  test("run-command clears L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("read-file", { paths: [{ path: "/a.ts" }] }, { result: "content" });

    cache1.invalidateForWrite("run-command", {});

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("read-file", { paths: [{ path: "/a.ts" }] })).toBeUndefined();
  });

  test("clear propagates to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("read-file", { paths: [{ path: "/a.ts" }] }, { result: "content" });

    cache1.clear();

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("read-file", { paths: [{ path: "/a.ts" }] })).toBeUndefined();
  });
});
