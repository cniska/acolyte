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
    cache1.set("file-read", { paths: [{ path: "/a.ts" }] }, { result: "content-a" });

    // New L1 cache, same L2 store — simulates a new task
    const cache2 = createToolCache(CACHEABLE, 256, store);
    const entry = cache2.get("file-read", { paths: [{ path: "/a.ts" }] });
    expect(entry).toBeDefined();
    expect(entry?.result).toBe("content-a");
  });

  test("pathless entries are not persisted to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-search", { patterns: ["foo"] }, { result: "found" });

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-search", { patterns: ["foo"] })).toBeUndefined();
  });

  test("write invalidation propagates to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-read", { paths: [{ path: "/a.ts" }] }, { result: "old" });

    cache1.invalidateForWrite("file-edit", { path: "/a.ts" });

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-read", { paths: [{ path: "/a.ts" }] })).toBeUndefined();
  });

  test("shell-run clears L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-read", { paths: [{ path: "/a.ts" }] }, { result: "content" });

    cache1.invalidateForWrite("shell-run", {});

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-read", { paths: [{ path: "/a.ts" }] })).toBeUndefined();
  });

  test("clear propagates to L2", () => {
    const store = createStore();
    const cache1 = createToolCache(CACHEABLE, 256, store);
    cache1.set("file-read", { paths: [{ path: "/a.ts" }] }, { result: "content" });

    cache1.clear();

    const cache2 = createToolCache(CACHEABLE, 256, store);
    expect(cache2.get("file-read", { paths: [{ path: "/a.ts" }] })).toBeUndefined();
  });
});
