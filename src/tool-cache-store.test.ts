import { afterEach, describe, expect, test } from "bun:test";
import { tempDb } from "./test-utils";
import { createToolCacheStore } from "./tool-cache-store";

const { create, cleanup } = tempDb("acolyte-cache-", createToolCacheStore);
afterEach(cleanup);

describe("createToolCacheStore", () => {
  test("get returns null for missing key", () => {
    const store = create();
    expect(store.get("missing")).toBeNull();
  });

  test("set + get round-trips", () => {
    const store = create();
    store.set("key1", '{"result":"hello"}', ["/src/a.ts"]);
    expect(store.get("key1")).toBe('{"result":"hello"}');
  });

  test("set replaces existing entry", () => {
    const store = create();
    store.set("key1", "v1", []);
    store.set("key1", "v2", []);
    expect(store.get("key1")).toBe("v2");
  });

  test("invalidateByPath removes entries with matching paths", () => {
    const store = create();
    store.set("key1", "v1", ["/src/a.ts"]);
    store.set("key2", "v2", ["/src/b.ts"]);
    store.set("key3", "v3", ["/src/a.ts", "/src/c.ts"]);
    const removed = store.invalidateByPath(["/src/a.ts"]);
    expect(removed).toBe(2);
    expect(store.get("key1")).toBeNull();
    expect(store.get("key2")).toBe("v2");
    expect(store.get("key3")).toBeNull();
  });

  test("invalidateByPath with empty paths returns 0", () => {
    const store = create();
    store.set("key1", "v1", ["/src/a.ts"]);
    expect(store.invalidateByPath([])).toBe(0);
    expect(store.get("key1")).toBe("v1");
  });

  test("clear removes all entries", () => {
    const store = create();
    store.set("key1", "v1", ["/src/a.ts"]);
    store.set("key2", "v2", ["/src/b.ts"]);
    store.clear();
    expect(store.get("key1")).toBeNull();
    expect(store.get("key2")).toBeNull();
  });
});
