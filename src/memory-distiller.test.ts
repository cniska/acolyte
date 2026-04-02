import { describe, expect, test } from "bun:test";
import type { MemoryKind, MemoryRecord, MemoryStore } from "./memory-contract";
import { createMemoryDistiller, DISTILLER_PROMPT, resolveMemoryPolicy } from "./memory-distiller";

const testPolicy = resolveMemoryPolicy({ messageThreshold: 1, maxOutputTokens: 200 });

function createTestDistiller(
  store: MemoryStore & { written: MemoryRecord[]; removed: string[] },
  runner?: (systemPrompt: string, userContent: string) => Promise<string>,
  options?: { commitScope?: "session" | "project" | "user" | "none" },
) {
  return createMemoryDistiller(store, runner, { policy: testPolicy, ...options });
}

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

describe("memoryDistiller", () => {
  describe("commit", () => {
    test("skips when no sessionId", async () => {
      const store = createMockStore();
      const source = createTestDistiller(store);
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        messages: Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `msg ${i}` })),
        output: "response",
      });
      expect(store.written).toHaveLength(0);
    });

    test("skips when messages below threshold", async () => {
      const store = createMockStore();
      const source = createMemoryDistiller(store, undefined, {
        policy: resolveMemoryPolicy({ messageThreshold: 5 }),
      });
      if (!source.commit) throw new Error("expected commit handler");
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "hi",
      });
      expect(store.written).toHaveLength(0);
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
      const source = createTestDistiller(store, async (systemPrompt) => {
        if (systemPrompt === DISTILLER_PROMPT) return " @observe session\n prefers   short answers ";
        return "";
      });
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
      const source = createTestDistiller(store, async (systemPrompt) => {
        if (systemPrompt !== DISTILLER_PROMPT) return "";
        return [
          "untagged fact should be dropped",
          "Current task: also dropped without directive",
          "@observe session",
          "tagged fact is kept",
        ].join("\n");
      });
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
      const source = createTestDistiller(store, async (systemPrompt) => {
        if (systemPrompt !== DISTILLER_PROMPT) return "";
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
      });
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
      const source = createMemoryDistiller(
        store,
        async (systemPrompt) => (systemPrompt === DISTILLER_PROMPT ? "scope fact" : ""),
        {
          policy: testPolicy,
          commitScope: "project",
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
      const source = createTestDistiller(store, async (systemPrompt) => {
        if (systemPrompt !== DISTILLER_PROMPT) return "";
        return [
          "@observe project",
          "repo uses Bun",
          "@observe user",
          "prefers short answers",
          "@observe session",
          "fix failing tests",
        ].join("\n");
      });
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
      const source = createTestDistiller(store, async (systemPrompt) => {
        if (systemPrompt !== DISTILLER_PROMPT) return "";
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
      });
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
      const fixturePolicy = resolveMemoryPolicy({ messageThreshold: 1, maxOutputTokens: 10_000 });
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
        const source = createMemoryDistiller(
          store,
          async (systemPrompt) => {
            if (systemPrompt !== DISTILLER_PROMPT) return "";
            return fixture.observed;
          },
          { policy: fixturePolicy },
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
