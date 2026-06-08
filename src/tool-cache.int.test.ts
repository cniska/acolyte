import { afterEach, describe, expect, test } from "bun:test";
import { tempDb } from "./test-utils";
import { createToolCache } from "./tool-cache";
import { createToolCacheStore } from "./tool-cache-store";

const CACHEABLE = new Set(["file-read", "file-find", "file-search", "code-scan"]);
const { create: createStore, cleanup } = tempDb("acolyte-cache-l2-", createToolCacheStore);
afterEach(cleanup);

describe("L2 SQLite integration", () => {
  test("L1 miss falls back to L2 hit", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-read", { path: "/a.ts" }, { result: "content-a" });

    // New L1 cache, same L2 store — simulates a new task
    const cache2 = createToolCache(CACHEABLE, 256, store);
    const entry = cache2.get("file-read", { path: "/a.ts" });
    expect(entry).toBeDefined();
    expect(entry?.result).toBe("content-a");
  });

  test("file-read windows persist and invalidate by path in L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-read", { path: "/a.ts", aroundLine: 10, contextLines: 20 }, { result: "window-a" });
    cache1.set("file-read", { path: "/b.ts", aroundLine: 10, contextLines: 20 }, { result: "window-b" });

    cache1.invalidateForWrite("file-edit", { path: "/a.ts" });

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-read", { path: "/a.ts", aroundLine: 10, contextLines: 20 })).toBeUndefined();
    expect(cache2.get("file-read", { path: "/b.ts", aroundLine: 10, contextLines: 20 })?.result).toBe("window-b");
  });

  test("pathless entries are not persisted to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-search", { pattern: "foo" }, { result: "found" });

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-search", { pattern: "foo" })).toBeUndefined();
  });

  test("write invalidation propagates to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-read", { path: "/a.ts" }, { result: "old" });

    cache1.invalidateForWrite("file-edit", { path: "/a.ts" });

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-read", { path: "/a.ts" })).toBeUndefined();
  });

  test("shell-run clears L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-read", { path: "/a.ts" }, { result: "content" });

    cache1.invalidateForWrite("shell-run", {});

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-read", { path: "/a.ts" })).toBeUndefined();
  });

  test("clear propagates to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-read", { path: "/a.ts" }, { result: "content" });

    cache1.clear();

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-read", { path: "/a.ts" })).toBeUndefined();
  });
});
