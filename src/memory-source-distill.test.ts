import { afterEach, describe, expect, test } from "bun:test";
import type { DistillRecord } from "./memory-contract";
import type { DistillStore } from "./memory-distill-store";
import { createDistillMemorySource } from "./memory-source-distill";

function createMockStore(records: DistillRecord[] = []): DistillStore & { written: DistillRecord[] } {
  const written: DistillRecord[] = [];
  return {
    written,
    async list(sessionId) {
      return records.filter((r) => r.sessionId === sessionId);
    },
    async write(record) {
      records.push(record);
      written.push(record);
    },
  };
}

describe("distillMemorySource", () => {
  describe("load", () => {
    test("returns empty when no sessionId", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(store);
      const entries = await source.load({});
      expect(entries).toEqual([]);
    });

    test("returns observation content when no reflections", async () => {
      const store = createMockStore([
        {
          id: "dst_obs00001",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "user prefers Bun",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 4,
        },
        {
          id: "dst_obs00002",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "auth module in src/auth/",
          createdAt: "2026-03-04T11:00:00.000Z",
          tokenEstimate: 5,
        },
      ]);
      const source = createDistillMemorySource(store);
      const entries = await source.load({ sessionId: "sess_test0001" });
      expect(entries).toEqual(["auth module in src/auth/", "user prefers Bun"]);
    });

    test("returns latest reflection and preserves observations created after it", async () => {
      const store = createMockStore([
        {
          id: "dst_obs00001",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "old observation",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 3,
        },
        {
          id: "dst_ref00001",
          sessionId: "sess_test0001",
          tier: "reflection",
          content: "older reflection",
          createdAt: "2026-03-04T11:00:00.000Z",
          tokenEstimate: 3,
        },
        {
          id: "dst_ref00002",
          sessionId: "sess_test0001",
          tier: "reflection",
          content: "latest reflection",
          createdAt: "2026-03-04T12:00:00.000Z",
          tokenEstimate: 3,
        },
        {
          id: "dst_obs00002",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "new observation",
          createdAt: "2026-03-04T12:30:00.000Z",
          tokenEstimate: 3,
        },
      ]);
      const source = createDistillMemorySource(store);
      const entries = await source.load({ sessionId: "sess_test0001" });
      expect(entries).toEqual(["latest reflection", "new observation"]);
    });

    test("returns empty for session with no records", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(store);
      const entries = await source.load({ sessionId: "sess_empty001" });
      expect(entries).toEqual([]);
    });
  });

  describe("commit", () => {
    test("skips when no sessionId", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(store);
      await source.commit!({
        messages: Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `msg ${i}` })),
        output: "response",
      });
      expect(store.written).toHaveLength(0);
    });

    test("skips when messages below threshold", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(store);
      await source.commit!({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "hi",
      });
      expect(store.written).toHaveLength(0);
    });
  });
});
