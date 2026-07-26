import { describe, expect, test } from "bun:test";
import type { MemoryKind, MemoryRecord, MemoryStore } from "./memory-contract";
import { createMemoryPolicy } from "./memory-contract";
import type { DistillObservation } from "./memory-distiller";
import { createDistillInput, createMemoryDistiller, DISTILLER_PROMPT } from "./memory-distiller";

const testPolicy = createMemoryPolicy({ messageThreshold: 1, maxOutputTokens: 200 });

function createTestDistiller(
  store: MemoryStore & { written: MemoryRecord[]; removed: string[] },
  runner?: (systemPrompt: string, userContent: string) => Promise<DistillObservation[]>,
  options?: { commitScope?: "session" | "project" | "user" | "none" },
) {
  return createMemoryDistiller({ store, runner, policy: testPolicy, ...options });
}

function createMockStore(records: MemoryRecord[] = []): MemoryStore & { written: MemoryRecord[]; removed: string[] } {
  const written: MemoryRecord[] = [];
  const removed: string[] = [];
  return {
    storage: "sqlite",
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
    async touchRecalled() {},
    async writeEmbedding() {},
    async removeEmbedding() {},
    async getEmbedding() {
      return null;
    },
    async getEmbeddings() {
      return new Map();
    },
    close() {},
  };
}

function makeRunner(observations: DistillObservation[]) {
  return async (systemPrompt: string): Promise<DistillObservation[]> => {
    if (systemPrompt === DISTILLER_PROMPT) return observations;
    return [];
  };
}

describe("createDistillInput", () => {
  const messages = [{ role: "user", content: "fix the build" }];

  test("leads with an observed entry when activity is present", () => {
    const input = createDistillInput(messages, "done", {
      filesChanged: ["src/a.ts"],
      commands: [{ command: "bun test", failed: false }],
      errors: [],
    });
    expect(input.startsWith("observed: Files changed:\n- src/a.ts")).toBe(true);
    expect(input).toContain("user: fix the build");
    expect(input).toContain("assistant: done");
  });

  test("omits the digest for empty or absent activity", () => {
    const bare = createDistillInput(messages, "done");
    expect(bare).toBe("user: fix the build\n\nassistant: done");
    expect(createDistillInput(messages, "done", { filesChanged: [], commands: [], errors: [] })).toBe(bare);
  });
});

describe("high-water mark", () => {
  function captureRunner(seen: string[]) {
    return async (_prompt: string, userContent: string): Promise<DistillObservation[]> => {
      seen.push(userContent);
      return [];
    };
  }

  const turnOne = [
    { role: "user", content: "turn one" },
    { role: "assistant", content: "reply one" },
  ];

  test("a later commit re-sends nothing the distiller already saw", async () => {
    const seen: string[] = [];
    const distiller = createMemoryDistiller({
      store: createMockStore(),
      runner: captureRunner(seen),
      policy: testPolicy,
    });
    await distiller.commit({ sessionId: "sess_test0001", messages: turnOne, output: "done one" });
    await distiller.commit({
      sessionId: "sess_test0001",
      messages: [...turnOne, { role: "user", content: "turn two" }],
      output: "done two",
    });
    expect(seen[0]).toContain("turn one");
    expect(seen[1]).toContain("turn two");
    expect(seen[1]).not.toContain("turn one");
  });

  test("a failed write leaves the messages re-readable next commit", async () => {
    const seen: string[] = [];
    const store = createMockStore();
    let failWrite = true;
    store.write = async () => {
      if (failWrite) throw new Error("disk full");
    };
    const distiller = createMemoryDistiller({
      store,
      runner: async (_prompt, userContent) => {
        seen.push(userContent);
        return [{ scope: "session", content: "a durable fact", topic: null }];
      },
      policy: testPolicy,
    });
    await expect(
      distiller.commit({ sessionId: "sess_test0001", messages: turnOne, output: "done one" }),
    ).rejects.toThrow();
    failWrite = false;
    await distiller.commit({
      sessionId: "sess_test0001",
      messages: [...turnOne, { role: "user", content: "turn two" }],
      output: "done two",
    });
    expect(seen[1]).toContain("turn one");
  });

  test("each session keeps its own mark", async () => {
    const seen: string[] = [];
    const distiller = createMemoryDistiller({
      store: createMockStore(),
      runner: captureRunner(seen),
      policy: testPolicy,
    });
    await distiller.commit({ sessionId: "sess_test0001", messages: turnOne, output: "done" });
    await distiller.commit({ sessionId: "sess_test0002", messages: turnOne, output: "done" });
    expect(seen[1]).toContain("turn one");
  });

  test("the context window still caps how far back a first commit reaches", async () => {
    const seen: string[] = [];
    const distiller = createMemoryDistiller({
      store: createMockStore(),
      runner: captureRunner(seen),
      policy: createMemoryPolicy({ messageThreshold: 1, contextMessageWindow: 2 }),
    });
    await distiller.commit({
      sessionId: "sess_test0001",
      messages: [
        { role: "user", content: "oldest" },
        { role: "assistant", content: "middle" },
        { role: "user", content: "newest" },
      ],
      output: "done",
    });
    expect(seen[0]).not.toContain("oldest");
    expect(seen[0]).toContain("newest");
  });
});

describe("memoryDistiller", () => {
  describe("commit", () => {
    test("skips when no sessionId", async () => {
      const store = createMockStore();
      const source = createTestDistiller(store, makeRunner([{ scope: "session", content: "a fact", topic: null }]));
      await source.commit({
        messages: Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `msg ${i}` })),
        output: "response",
      });
      expect(store.written).toHaveLength(0);
    });

    test("skips when messages below threshold", async () => {
      const store = createMockStore();
      const source = createMemoryDistiller({
        store,
        runner: makeRunner([{ scope: "session", content: "a fact", topic: null }]),
        policy: createMemoryPolicy({ messageThreshold: 5 }),
      });
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "hi",
      });
      expect(store.written).toHaveLength(0);
    });

    test("skips a duplicate of any earlier observation, not just the latest", async () => {
      const store = createMockStore([
        {
          id: "mem_obs_prev",
          scopeKey: "sess_test0001",
          kind: "observation",
          content: "prefers short answers",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 6,
        },
        {
          id: "mem_obs_newer",
          scopeKey: "sess_test0001",
          kind: "observation",
          content: "the build runs on bun",
          createdAt: "2026-03-04T11:00:00.000Z",
          tokenEstimate: 6,
        },
      ]);
      const source = createTestDistiller(
        store,
        makeRunner([{ scope: "session", content: "prefers short answers", topic: null }]),
      );
      await source.commit({
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      expect(store.written).toHaveLength(0);
    });

    test("commits nothing when the turn establishes nothing", async () => {
      const store = createMockStore();
      const source = createTestDistiller(store, makeRunner([]));
      const metrics = await source.commit({
        sessionId: "sess_test0001",
        resourceId: "proj_abc123",
        messages: [{ role: "user", content: "hello" }],
        output: "Hello.",
      });
      expect(store.written).toHaveLength(0);
      expect(metrics).toBeUndefined();
    });

    test("stores topic on observations", async () => {
      const store = createMockStore();
      const source = createTestDistiller(
        store,
        makeRunner([
          { scope: "project", content: "project uses Vitest", topic: "testing" },
          { scope: "project", content: "repo has 18k lines of code", topic: null },
        ]),
      );
      await source.commit({
        sessionId: "sess_test0001",
        resourceId: "proj_abc123",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      const withTopic = store.written.find((e) => e.content === "project uses Vitest");
      const withoutTopic = store.written.find((e) => e.content === "repo has 18k lines of code");
      expect(withTopic?.topic).toBe("testing");
      expect(withoutTopic?.topic).toBeNull();
    });

    test("session commit promotes project and user observations to scoped stores", async () => {
      const store = createMockStore();
      const source = createTestDistiller(
        store,
        makeRunner([
          { scope: "project", content: "repo uses Bun", topic: null },
          { scope: "user", content: "prefers short answers", topic: null },
          { scope: "session", content: "fix failing tests", topic: null },
        ]),
      );
      await source.commit({
        sessionId: "sess_test0001",
        resourceId: "proj_abc123",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });

      const byScope = new Map(store.written.map((entry) => [entry.scopeKey, entry.content]));
      expect(byScope.get("sess_test0001")).toBe("fix failing tests");
      expect(byScope.get("proj_abc123")).toBe("repo uses Bun");
      const userScopeKey = [...byScope.keys()].find((key) => key.startsWith("user_"));
      expect(userScopeKey).toBeDefined();
      expect(userScopeKey ? byScope.get(userScopeKey) : "").toBe("prefers short answers");
    });

    test("returns scoped promotion metrics", async () => {
      const store = createMockStore();
      const source = createTestDistiller(
        store,
        makeRunner([
          { scope: "project", content: "project fact one", topic: null },
          { scope: "project", content: "project fact two", topic: null },
          { scope: "user", content: "user fact one", topic: null },
          { scope: "session", content: "session fact one", topic: null },
          { scope: "project", content: "project fact three", topic: null },
        ]),
      );
      const metrics = await source.commit({
        sessionId: "sess_test0001",
        resourceId: "proj_abc123",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      expect(metrics).toMatchObject({
        projectPromotedFacts: 3,
        userPromotedFacts: 1,
        sessionScopedFacts: 1,
      });
    });

    test("commitScope filters to only commit matching scope", async () => {
      const store = createMockStore();
      const source = createMemoryDistiller({
        store,
        runner: makeRunner([
          { scope: "project", content: "a project fact", topic: null },
          { scope: "session", content: "a session fact", topic: null },
          { scope: "user", content: "a user fact", topic: null },
        ]),
        policy: testPolicy,
        commitScope: "project",
      });
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

    test("quality fixtures classify observations into the right scopes", async () => {
      const fixturePolicy = createMemoryPolicy({ messageThreshold: 1, maxOutputTokens: 10_000 });
      const fixtures = [
        {
          name: "good_scoped_output",
          observations: [
            { scope: "project" as const, content: "uses bun test", topic: null },
            { scope: "user" as const, content: "prefers concise responses", topic: null },
            { scope: "session" as const, content: "fixing failing memory tests", topic: null },
            { scope: "session" as const, content: "stabilize memory quality", topic: null },
            { scope: "session" as const, content: "add regression coverage", topic: null },
          ],
          expectedMetrics: {
            projectPromotedFacts: 1,
            userPromotedFacts: 1,
            sessionScopedFacts: 3,
          },
          expectedWriteCount: 5,
        },
        {
          name: "only_project_observations",
          observations: [{ scope: "project" as const, content: "uses bun test", topic: null }],
          expectedMetrics: {
            projectPromotedFacts: 1,
            userPromotedFacts: 0,
            sessionScopedFacts: 0,
          },
          expectedWriteCount: 1,
        },
      ] as const;

      for (const fixture of fixtures) {
        const store = createMockStore();
        const source = createMemoryDistiller({
          store,
          runner: makeRunner([...fixture.observations]),
          policy: fixturePolicy,
        });
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
