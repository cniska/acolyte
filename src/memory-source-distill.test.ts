import { describe, expect, test } from "bun:test";
import type { MemoryKind, MemoryRecord, MemoryStore } from "./memory-contract";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import { createDistillMemorySource, type DistillConfig } from "./memory-source-distill";

const testDistillConfig: DistillConfig = {
  model: "test-model",
  messageThreshold: 1,
  reflectionThresholdTokens: 50,
  maxOutputTokens: 200,
};

function createMockStore(records: MemoryRecord[] = []): MemoryStore & { written: MemoryRecord[]; removed: string[] } {
  const written: MemoryRecord[] = [];
  const removed: string[] = [];
  return {
    written,
    removed,
    async list(options?: { scopeKey?: string; kind?: MemoryKind }) {
      return records.filter(
        (r) => (!options?.scopeKey || r.scopeKey === options.scopeKey) && (!options?.kind || r.kind === options.kind),
      );
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
          id: "mem_obs_old",
          scopeKey: "sess_test0001",
          kind: "observation",
          content: "old observation",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 3,
        },
        {
          id: "mem_ref_old",
          scopeKey: "sess_test0001",
          kind: "reflection",
          content: "old reflection",
          createdAt: "2026-03-04T10:30:00.000Z",
          tokenEstimate: 3,
        },
      ]);
      const reflectorInputs: string[] = [];
      const source = createDistillMemorySource(
        store,
        async (systemPrompt, input) => {
          if (systemPrompt === OBSERVER_PROMPT) return "@observe session\nnew observation";
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
          id: "mem_obs_old",
          scopeKey: "sess_test0001",
          kind: "observation",
          content: "old observation that was before the reflection",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 10,
        },
        {
          id: "mem_ref_old",
          scopeKey: "sess_test0001",
          kind: "reflection",
          content: "old reflection",
          createdAt: "2026-03-04T10:30:00.000Z",
          tokenEstimate: 4,
        },
      ]);
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT)
            return "@observe session\na new observation with enough tokens to exceed the reflection threshold for this test";
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
      expect(store.written.filter((e) => e.kind === "observation")).toHaveLength(1);
      expect(store.written.filter((e) => e.kind === "reflection")).toHaveLength(1);
      // Old observation (pre-reflection) and old reflection were GC'd
      // The new observation (post-old-reflection, consolidated into new reflection) was also GC'd
      expect(store.removed).toContain("mem_ref_old");
      expect(store.removed.some((id) => id !== "mem_ref_old")).toBe(true);
      // Only the new reflection remains in the store
      const remaining = await store.list({ scopeKey: "sess_test0001" });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.kind).toBe("reflection");
    });

    test("skips writing reflection when retry compression cannot reduce size", async () => {
      const store = createMockStore();
      let reflectionCalls = 0;
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT) return "@observe session\ntiny observation";
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
      expect(store.written.filter((entry) => entry.kind === "observation")).toHaveLength(1);
      expect(store.written.filter((entry) => entry.kind === "reflection")).toHaveLength(0);
    });

    test("skips consecutive duplicate observations", async () => {
      const store = createMockStore([
        {
          id: "mem_obs_prev",
          scopeKey: "sess_test0001",
          kind: "observation",
          content: "prefers short answers",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 6,
        },
      ]);
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt === OBSERVER_PROMPT) return " @observe session\n prefers   short answers ";
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
          return [
            "untagged fact should be dropped",
            "Current task: also dropped without directive",
            "@observe session",
            "tagged fact is kept",
          ].join("\n");
        },
        { config: { ...testDistillConfig, reflectionThresholdTokens: 999_999, maxOutputTokens: 10_000 } },
      );
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      const sessionEntry = store.written.find((entry) => entry.scopeKey === "sess_test0001");
      expect(sessionEntry?.content).toContain("tagged fact is kept");
      expect(sessionEntry?.content).not.toContain("untagged fact should be dropped");
      expect(sessionEntry?.content).not.toContain("Current task:");
    });

    test("silently drops malformed scope tags and commits valid facts", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "@observe project",
            "valid project fact",
            "@observe user",
            "valid user fact",
            "@observe proj",
            "malformed tag dropped",
            "@observe usr",
            "malformed tag dropped",
            "@observe session",
            "valid session fact",
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
      expect(metrics).toMatchObject({
        projectPromotedFacts: 1,
        userPromotedFacts: 1,
        sessionScopedFacts: 1,
        droppedUntaggedFacts: 2,
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

      expect(store.written.filter((entry) => entry.kind === "observation")).toHaveLength(1);
      const keys = store.written.map((entry) => entry.scopeKey);
      expect(keys.some((key) => key.startsWith("proj_"))).toBe(true);
      expect(keys.some((key) => key === "sess_test0001")).toBe(false);
      expect(keys.some((key) => key.startsWith("user_"))).toBe(false);
    });

    test("session commit promotes @observe project and @observe user lines to scoped stores", async () => {
      const store = createMockStore();
      const source = createDistillMemorySource(
        store,
        async (systemPrompt) => {
          if (systemPrompt !== OBSERVER_PROMPT) return "";
          return [
            "@observe project",
            "repo uses Bun",
            "@observe user",
            "prefers short answers",
            "@observe session",
            "fix failing tests",
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

      const byScope = new Map(store.written.map((entry) => [entry.scopeKey, entry.content]));
      expect(byScope.get("sess_test0001")).toContain("fix failing tests");
      expect(byScope.get("sess_test0001")).not.toContain("@observe project");
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
            "@observe project",
            "project fact one",
            "@observe project",
            "project fact two",
            "@observe user",
            "user fact one",
            "@observe session",
            "session fact one",
            "Current task: keep continuation",
            "@observe project",
            "Next step: continuation forced to session",
            "untagged dropped fact",
            "@observe proj",
            "malformed tag dropped",
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
      // "Current task:" and "Next step:" lines without @observe are dropped as untagged.
      // The line after @observe proj (malformed) also becomes untagged.
      expect(metrics).toMatchObject({
        projectPromotedFacts: 3,
        userPromotedFacts: 1,
        sessionScopedFacts: 1,
        droppedUntaggedFacts: 3,
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
            "@observe project",
            "uses bun test",
            "@observe user",
            "prefers concise responses",
            "@observe session",
            "fixing failing memory tests",
            "@observe session",
            "stabilize memory quality",
            "@observe session",
            "add regression coverage",
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
          observed: [
            "@observe project",
            "uses bun test",
            "untagged fact",
            "Current task: also untagged without directive",
          ].join("\n"),
          expectedMetrics: {
            projectPromotedFacts: 1,
            userPromotedFacts: 0,
            sessionScopedFacts: 0,
            droppedUntaggedFacts: 2,
          },
          expectedWriteCount: 1,
        },
        {
          name: "malformed_tag_silently_dropped",
          observed: [
            "@observe project",
            "uses bun test",
            "@observe proj",
            "malformed tag silently dropped",
            "Current task: also untagged without directive",
          ].join("\n"),
          expectedMetrics: {
            projectPromotedFacts: 1,
            userPromotedFacts: 0,
            sessionScopedFacts: 0,
            droppedUntaggedFacts: 2,
          },
          expectedWriteCount: 1,
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
        expect(metrics, fixture.name).toMatchObject(fixture.expectedMetrics);
        expect(store.written.length, fixture.name).toBe(fixture.expectedWriteCount);
      }
    });
  });
});
