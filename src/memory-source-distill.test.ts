import { afterEach, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import type { DistillRecord } from "./memory-contract";
import type { DistillStore } from "./memory-distill-store";
import { createDistillMemorySource } from "./memory-source-distill";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";

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
    async function loadContents(source: ReturnType<typeof createDistillMemorySource>, ctx: { sessionId?: string }) {
      const entries = await source.loadEntries(ctx);
      return entries.map((entry) => entry.content);
    }

    test("returns empty when no sessionId", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(store);
      const entries = await loadContents(source, {});
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
      const entries = await loadContents(source, { sessionId: "sess_test0001" });
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
      const entries = await loadContents(source, { sessionId: "sess_test0001" });
      expect(entries).toEqual(["latest reflection", "new observation"]);
    });

    test("orders post-reflection observations by recency", async () => {
      const store = createMockStore([
        {
          id: "dst_ref00001",
          sessionId: "sess_test0001",
          tier: "reflection",
          content: "latest reflection",
          createdAt: "2026-03-04T12:00:00.000Z",
          tokenEstimate: 3,
        },
        {
          id: "dst_obs00001",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "older observation",
          createdAt: "2026-03-04T12:10:00.000Z",
          tokenEstimate: 3,
        },
        {
          id: "dst_obs00002",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "newer observation",
          createdAt: "2026-03-04T12:20:00.000Z",
          tokenEstimate: 3,
        },
      ]);
      const source = createDistillMemorySource(store);
      const entries = await loadContents(source, { sessionId: "sess_test0001" });
      expect(entries).toEqual(["latest reflection", "newer observation", "older observation"]);
    });

    test("uses continuation from most recent post-reflection observation", async () => {
      const store = createMockStore([
        {
          id: "dst_ref00001",
          sessionId: "sess_test0001",
          tier: "reflection",
          content: "latest reflection",
          createdAt: "2026-03-04T12:00:00.000Z",
          tokenEstimate: 3,
        },
        {
          id: "dst_obs00001",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "older observation",
          currentTask: "Old task",
          nextStep: "Old step",
          createdAt: "2026-03-04T12:10:00.000Z",
          tokenEstimate: 3,
        },
        {
          id: "dst_obs00002",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "newer observation",
          currentTask: "New task",
          nextStep: "New step",
          createdAt: "2026-03-04T12:20:00.000Z",
          tokenEstimate: 3,
        },
      ]);
      const source = createDistillMemorySource(store);
      const entries = await loadContents(source, { sessionId: "sess_test0001" });
      expect(entries).toEqual([
        "latest reflection",
        "newer observation",
        "older observation",
        "Current task: New task",
        "Next step: New step",
      ]);
    });

    test("appends continuation lines when available", async () => {
      const store = createMockStore([
        {
          id: "dst_obs00001",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "recent observation",
          currentTask: "Fix memory retrieval",
          nextStep: "Add regression tests",
          createdAt: "2026-03-04T12:30:00.000Z",
          tokenEstimate: 5,
        },
      ]);
      const source = createDistillMemorySource(store);
      const entries = await loadContents(source, { sessionId: "sess_test0001" });
      expect(entries).toEqual([
        "recent observation",
        "Current task: Fix memory retrieval",
        "Next step: Add regression tests",
      ]);
    });

    test("strips continuation lines from observation content and emits typed continuation once", async () => {
      const store = createMockStore([
        {
          id: "dst_obs00001",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "recent observation\nCurrent task: Fix memory retrieval\nNext step: Add regression tests",
          currentTask: "Fix memory retrieval",
          nextStep: "Add regression tests",
          createdAt: "2026-03-04T12:30:00.000Z",
          tokenEstimate: 5,
        },
      ]);
      const source = createDistillMemorySource(store);
      const entries = await loadContents(source, { sessionId: "sess_test0001" });
      expect(entries).toEqual([
        "recent observation",
        "Current task: Fix memory retrieval",
        "Next step: Add regression tests",
      ]);
    });

    test("loadEntries marks continuation lines as continuation entries", async () => {
      const store = createMockStore([
        {
          id: "dst_obs00001",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "recent observation",
          currentTask: "Fix memory retrieval",
          nextStep: "Add regression tests",
          createdAt: "2026-03-04T12:30:00.000Z",
          tokenEstimate: 5,
        },
      ]);
      const source = createDistillMemorySource(store);
      const entries = await source.loadEntries?.({ sessionId: "sess_test0001" });
      expect(entries?.map((entry) => entry.content)).toEqual([
        "recent observation",
        "Current task: Fix memory retrieval",
        "Next step: Add regression tests",
      ]);
      const continuationFlags = entries?.map((entry) => Boolean(entry.isContinuation));
      expect(continuationFlags).toEqual([false, true, true]);
    });

    test("returns empty for session with no records", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(store);
      const entries = await loadContents(source, { sessionId: "sess_empty001" });
      expect(entries).toEqual([]);
    });
  });

  describe("commit", () => {
    test("skips when no sessionId", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(store);
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        messages: Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `msg ${i}` })),
        output: "response",
      });
      expect(store.written).toHaveLength(0);
    });

    test("skips when messages below threshold", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(store);
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "hi",
      });
      expect(store.written).toHaveLength(0);
    });

    test("reflects only observations created since latest reflection", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 1,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore([
          {
            id: "dst_obs_old",
            sessionId: "sess_test0001",
            tier: "observation",
            content: "old observation",
            createdAt: "2026-03-04T10:00:00.000Z",
            tokenEstimate: 3,
          },
          {
            id: "dst_ref_old",
            sessionId: "sess_test0001",
            tier: "reflection",
            content: "old reflection",
            createdAt: "2026-03-04T10:30:00.000Z",
            tokenEstimate: 3,
          },
        ]);
        const reflectorInputs: string[] = [];
        const source = createDistillMemorySource(store, async (systemPrompt, input) => {
          if (systemPrompt === OBSERVER_PROMPT) return "[session] new observation";
          if (systemPrompt === REFLECTOR_PROMPT) {
            reflectorInputs.push(input);
            return "new reflection";
          }
          return "";
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });

        expect(reflectorInputs.length).toBeGreaterThan(0);
        const latestReflectorInput = reflectorInputs[reflectorInputs.length - 1];
        expect(latestReflectorInput).toContain("new observation");
        expect(latestReflectorInput).not.toContain("old observation");
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("skips writing reflection when retry compression cannot reduce size", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 1,
        maxOutputTokens: 100_000,
      };
      try {
        const store = createMockStore();
        let reflectionCalls = 0;
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT) return "[session] tiny observation";
          if (systemPrompt === REFLECTOR_PROMPT) {
            reflectionCalls += 1;
            return "x".repeat(2_000);
          }
          return "";
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });

        expect(reflectionCalls).toBe(3);
        expect(store.written.filter((entry) => entry.tier === "observation")).toHaveLength(1);
        expect(store.written.filter((entry) => entry.tier === "reflection")).toHaveLength(0);
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("stores parsed continuation fields from observation output", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT)
            return "[session] fact line\nCurrent task: Implement rolling context\nNext step: Add continuation fields";
          return "";
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        const writtenObservation = store.written.find((entry) => entry.tier === "observation");
        expect(writtenObservation?.currentTask).toBe("Implement rolling context");
        expect(writtenObservation?.nextStep).toBe("Add continuation fields");
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("stores parsed continuation fields from bullet observation output", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT)
            return "[session] fact line\n- Current task: Bullet task\n* Next step: Bullet next";
          return "";
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        const writtenObservation = store.written.find((entry) => entry.tier === "observation");
        expect(writtenObservation?.currentTask).toBe("Bullet task");
        expect(writtenObservation?.nextStep).toBe("Bullet next");
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("stores last continuation fields when multiple lines are present", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT)
            return [
              "Current task: Old task",
              "Next step: Old step",
              "Current task: New task",
              "Next step: New step",
            ].join("\n");
          return "";
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        const writtenObservation = store.written.find((entry) => entry.tier === "observation");
        expect(writtenObservation?.currentTask).toBe("New task");
        expect(writtenObservation?.nextStep).toBe("New step");
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("skips consecutive duplicate observations", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore([
          {
            id: "dst_obs_prev",
            sessionId: "sess_test0001",
            tier: "observation",
            content: "prefers short answers",
            createdAt: "2026-03-04T10:00:00.000Z",
            tokenEstimate: 6,
          },
        ]);
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT) return " [session] prefers   short answers ";
          return "";
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        expect(store.written).toHaveLength(0);
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("drops untagged fact lines during session commit", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return ["untagged fact should be dropped", "Current task: keep tagged facts only"].join("\n");
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        const sessionEntry = store.written.find((entry) => entry.sessionId === "sess_test0001");
        expect(sessionEntry?.content).toContain("Current task: keep tagged facts only");
        expect(sessionEntry?.content).not.toContain("untagged fact should be dropped");
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("keeps continuation lines in session scope even if tagged as project/user", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "[project] Current task: should stay session scoped",
            "[user] Next step: should stay session scoped",
            "[project] repo uses Bun",
            "[user] prefers concise replies",
          ].join("\n");
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          resourceId: "proj_abc123",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        const byScope = new Map(store.written.map((entry) => [entry.sessionId, entry.content]));
        expect(byScope.get("sess_test0001")).toContain("Current task: should stay session scoped");
        expect(byScope.get("sess_test0001")).toContain("Next step: should stay session scoped");
        expect(byScope.get("proj_abc123")).toBe("repo uses Bun");
        const userScopeKey = [...byScope.keys()].find((key) => key.startsWith("user_"));
        expect(userScopeKey).toBeDefined();
        expect(userScopeKey ? byScope.get(userScopeKey) : "").toBe("prefers concise replies");
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("rejects session commit when malformed tags are present", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "[project] valid project fact",
            "[user] valid user fact",
            "[proj] malformed tag dropped",
            "[usr] malformed tag dropped",
            "[session] valid session fact",
          ].join("\n");
        });
        if (!source.commit) throw new Error("expected commit handler");
        const metrics = await source.commit({
          sessionId: "sess_test0001",
          resourceId: "proj_abc123",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        expect(store.written).toHaveLength(0);
        expect(metrics).toEqual({
          projectPromotedFacts: 0,
          userPromotedFacts: 0,
          sessionScopedFacts: 0,
          droppedUntaggedFacts: 0,
          malformedTaggedFacts: 2,
        });
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("commitScope writes only the targeted scope", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(
          store,
          async (systemPrompt) => (systemPrompt === OBSERVER_PROMPT ? "scope fact" : ""),
          { commitScope: "project" },
        );
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          workspace: "/tmp/acolyte-project",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });

        expect(store.written.filter((entry) => entry.tier === "observation")).toHaveLength(1);
        const keys = store.written.map((entry) => entry.sessionId);
        expect(keys.some((key) => key.startsWith("proj_"))).toBe(true);
        expect(keys.some((key) => key === "sess_test0001")).toBe(false);
        expect(keys.some((key) => key.startsWith("user_"))).toBe(false);
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("session commit promotes [project] and [user] lines to scoped stores", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "[project] repo uses Bun",
            "[user] prefers short answers",
            "[session] fix failing tests",
            "Current task: stabilize memory",
            "Next step: add promotion tests",
          ].join("\n");
        });
        if (!source.commit) throw new Error("expected commit handler");
        await source.commit({
          sessionId: "sess_test0001",
          resourceId: "proj_abc123",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });

        const byScope = new Map(store.written.map((entry) => [entry.sessionId, entry.content]));
        expect(byScope.get("sess_test0001")).toContain("fix failing tests");
        expect(byScope.get("sess_test0001")).toContain("Current task: stabilize memory");
        expect(byScope.get("sess_test0001")).toContain("Next step: add promotion tests");
        expect(byScope.get("sess_test0001")).not.toContain("[project]");
        expect(byScope.get("sess_test0001")).not.toContain("repo uses Bun");
        expect(byScope.get("sess_test0001")).not.toContain("prefers short answers");
        expect(byScope.get("proj_abc123")).toBe("repo uses Bun");
        const userScopeKey = [...byScope.keys()].find((key) => key.startsWith("user_"));
        expect(userScopeKey).toBeDefined();
        expect(userScopeKey ? byScope.get(userScopeKey) : "").toBe("prefers short answers");
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });

    test("returns scoped promotion and drop metrics for mixed observations", async () => {
      const originalDistillConfig = { ...appConfig.distill };
      (appConfig as { distill: typeof appConfig.distill }).distill = {
        ...appConfig.distill,
        messageThreshold: 1,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      try {
        const store = createMockStore();
        const source = createDistillMemorySource(store, async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "[project] project fact one",
            "[project] project fact two",
            "[user] user fact one",
            "[session] session fact one",
            "Current task: keep continuation",
            "[project] Next step: continuation forced to session",
            "untagged dropped fact",
            "[proj] malformed tag dropped",
          ].join("\n");
        });
        if (!source.commit) throw new Error("expected commit handler");
        const metrics = await source.commit({
          sessionId: "sess_test0001",
          resourceId: "proj_abc123",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        expect(metrics).toEqual({
          projectPromotedFacts: 0,
          userPromotedFacts: 0,
          sessionScopedFacts: 0,
          droppedUntaggedFacts: 1,
          malformedTaggedFacts: 1,
        });
        expect(store.written).toHaveLength(0);
      } finally {
        (appConfig as { distill: typeof appConfig.distill }).distill = originalDistillConfig;
      }
    });
  });
});
