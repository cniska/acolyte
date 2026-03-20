import { describe, expect, test } from "bun:test";
import type { DistillRecord } from "./memory-contract";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import type { DistillStore } from "./memory-distill-store";
import { createDistillMemorySource, type DistillConfig } from "./memory-source-distill";

const testDistillConfig: DistillConfig = {
  model: "test-model",
  messageThreshold: 1,
  reflectionThresholdTokens: 50,
  maxOutputTokens: 200,
};

function createMockStore(
  records: DistillRecord[] = [],
): DistillStore & { written: DistillRecord[]; removed: string[] } {
  const written: DistillRecord[] = [];
  const removed: string[] = [];
  return {
    written,
    removed,
    async list(sessionId) {
      return records.filter((r) => r.sessionId === sessionId);
    },
    async write(record) {
      records.push(record);
      written.push(record);
    },
    async remove(id) {
      removed.push(id);
      const idx = records.findIndex((r) => r.id === id);
      if (idx >= 0) records.splice(idx, 1);
    },
    writeEmbedding() {},
    removeEmbedding() {},
    getEmbedding() {
      return null;
    },
    getEmbeddings() {
      return new Map();
    },
    close() {},
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
      const source = createDistillMemorySource(
        store,
        async (systemPrompt, input) => {
          if (systemPrompt === OBSERVER_PROMPT) return "[session] new observation";
          if (systemPrompt === REFLECTOR_PROMPT) {
            reflectorInputs.push(input);
            return "new reflection";
          }
          return "";
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 1, maxOutputTokens: 10_000 } },
      );
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
    });

    test("removes consolidated observations and old reflections after writing new reflection", async () => {
      const store = createMockStore([
        {
          id: "dst_obs_old",
          sessionId: "sess_test0001",
          tier: "observation",
          content: "old observation that was before the reflection",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 10,
        },
        {
          id: "dst_ref_old",
          sessionId: "sess_test0001",
          tier: "reflection",
          content: "old reflection",
          createdAt: "2026-03-04T10:30:00.000Z",
          tokenEstimate: 4,
        },
      ]);
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT)
            return "[session] a new observation with enough tokens to exceed the reflection threshold for this test";
          if (systemPrompt === REFLECTOR_PROMPT) return "compact";
          return "";
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 5, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });

      // New observation and reflection were written
      expect(store.written.filter((e) => e.tier === "observation")).toHaveLength(1);
      expect(store.written.filter((e) => e.tier === "reflection")).toHaveLength(1);
      // Old observation (pre-reflection) and old reflection were GC'd
      // The new observation (post-old-reflection, consolidated into new reflection) was also GC'd
      expect(store.removed).toContain("dst_ref_old");
      expect(store.removed.some((id) => id !== "dst_ref_old")).toBe(true);
      // Only the new reflection remains in the store
      const remaining = await store.list("sess_test0001");
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.tier).toBe("reflection");
    });

    test("skips writing reflection when retry compression cannot reduce size", async () => {
      const store = createMockStore();
      let reflectionCalls = 0;
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT) return "[session] tiny observation";
          if (systemPrompt === REFLECTOR_PROMPT) {
            reflectionCalls += 1;
            return "x".repeat(2_000);
          }
          return "";
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 1, maxOutputTokens: 100_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });

      expect(reflectionCalls).toBe(3);
      expect(store.written.filter((entry) => entry.tier === "observation")).toHaveLength(1);
      expect(store.written.filter((entry) => entry.tier === "reflection")).toHaveLength(0);
    });

    test("stores parsed continuation fields from observation output", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT)
            return "[session] fact line\nCurrent task: Implement rolling context\nNext step: Add continuation fields";
          return "";
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      const writtenObservation = store.written.find((entry) => entry.tier === "observation");
      expect(writtenObservation?.currentTask).toBe("Implement rolling context");
      expect(writtenObservation?.nextStep).toBe("Add continuation fields");
    });

    test("stores parsed continuation fields from bullet observation output", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT)
            return "[session] fact line\n- Current task: Bullet task\n* Next step: Bullet next";
          return "";
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      const writtenObservation = store.written.find((entry) => entry.tier === "observation");
      expect(writtenObservation?.currentTask).toBe("Bullet task");
      expect(writtenObservation?.nextStep).toBe("Bullet next");
    });

    test("stores last continuation fields when multiple lines are present", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT)
            return [
              "Current task: Old task",
              "Next step: Old step",
              "Current task: New task",
              "Next step: New step",
            ].join("\n");
          return "";
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      const writtenObservation = store.written.find((entry) => entry.tier === "observation");
      expect(writtenObservation?.currentTask).toBe("New task");
      expect(writtenObservation?.nextStep).toBe("New step");
    });

    test("skips consecutive duplicate observations", async () => {
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
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT) return " [session] prefers   short answers ";
          return "";
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      expect(store.written).toHaveLength(0);
    });

    test("drops untagged fact lines during session commit", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return ["untagged fact should be dropped", "Current task: keep tagged facts only"].join("\n");
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      const sessionEntry = store.written.find((entry) => entry.sessionId === "sess_test0001");
      expect(sessionEntry?.content).toContain("Current task: keep tagged facts only");
      expect(sessionEntry?.content).not.toContain("untagged fact should be dropped");
    });

    test("keeps continuation lines in session scope even if tagged as project/user", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "[project] Current task: should stay session scoped",
            "[user] Next step: should stay session scoped",
            "[project] repo uses Bun",
            "[user] prefers concise replies",
          ].join("\n");
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
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
    });

    test("silently drops malformed scope tags and commits valid facts", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "[project] valid project fact",
            "[user] valid user fact",
            "[proj] malformed tag dropped",
            "[usr] malformed tag dropped",
            "[session] valid session fact",
          ].join("\n");
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      const metrics = await source.commit({
        sessionId: "sess_test0001",
        resourceId: "proj_abc123",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      // Malformed tags are silently dropped; valid facts are committed.
      expect(store.written.length).toBeGreaterThan(0);
      expect(metrics).toEqual({
        projectPromotedFacts: 1,
        userPromotedFacts: 1,
        sessionScopedFacts: 1,
        droppedUntaggedFacts: 0,
      });
    });

    test("commitScope writes only the targeted scope", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => (systemPrompt === OBSERVER_PROMPT ? "scope fact" : ""),
        {
          commitScope: "project",
          config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 },
        },
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
    });

    test("session commit promotes [project] and [user] lines to scoped stores", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "[project] repo uses Bun",
            "[user] prefers short answers",
            "[session] fix failing tests",
            "Current task: stabilize memory",
            "Next step: add promotion tests",
          ].join("\n");
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
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
    });

    test("returns scoped promotion and drop metrics for mixed observations", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
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
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      const metrics = await source.commit({
        sessionId: "sess_test0001",
        resourceId: "proj_abc123",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      // Malformed tag is silently dropped; valid facts are committed.
      expect(metrics).toEqual({
        projectPromotedFacts: 2,
        userPromotedFacts: 1,
        sessionScopedFacts: 3,
        droppedUntaggedFacts: 1,
      });
      expect(store.written.length).toBeGreaterThan(0);
    });

    test("quality fixtures classify observer output into promote, drop, or reject paths", async () => {
      const fixtureConfig: DistillConfig = {
        ...testDistillConfig,
        reflectionThresholdTokens: 999_999,
        maxOutputTokens: 10_000,
      };
      const fixtures = [
        {
          name: "good_scoped_output",
          observed: [
            "[project] uses bun test",
            "[user] prefers concise responses",
            "[session] fixing failing memory tests",
            "Current task: stabilize memory quality",
            "Next step: add regression coverage",
          ].join("\n"),
          expectedMetrics: {
            projectPromotedFacts: 1,
            userPromotedFacts: 1,
            sessionScopedFacts: 3,
            droppedUntaggedFacts: 0,
          },
          expectedWriteCount: 3,
        },
        {
          name: "mixed_output_with_untagged_fact",
          observed: ["[project] uses bun test", "untagged fact", "Current task: stabilize memory quality"].join("\n"),
          expectedMetrics: {
            projectPromotedFacts: 1,
            userPromotedFacts: 0,
            sessionScopedFacts: 1,
            droppedUntaggedFacts: 1,
          },
          expectedWriteCount: 2,
        },
        {
          name: "malformed_tag_silently_dropped",
          observed: [
            "[project] uses bun test",
            "[proj] malformed tag silently dropped",
            "Current task: stabilize memory quality",
          ].join("\n"),
          expectedMetrics: {
            projectPromotedFacts: 1,
            userPromotedFacts: 0,
            sessionScopedFacts: 1,
            droppedUntaggedFacts: 0,
          },
          expectedWriteCount: 2,
        },
      ] as const;

      for (const fixture of fixtures) {
        const store = createMockStore();
        const source = createDistillMemorySource(
          store,
          async (systemPrompt) => {
            if (systemPrompt !== OBSERVER_PROMPT) return "";
            return fixture.observed;
          },
          { config: fixtureConfig },
        );
        if (!source.commit) throw new Error("expected commit handler");
        const metrics = await source.commit({
          sessionId: "sess_test0001",
          resourceId: "proj_abc123",
          messages: [{ role: "user", content: "hello" }],
          output: "done",
        });
        expect(metrics, fixture.name).toEqual(fixture.expectedMetrics);
        expect(store.written.length, fixture.name).toBe(fixture.expectedWriteCount);
      }
    });
  });
});
