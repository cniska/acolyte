import { describe, expect, test } from "bun:test";
import type { DistillScope } from "./distill-ops";
import type { MemoryDisposition, MemoryRecord, MemoryStore } from "./memory-contract";
import { createMemoryPolicy } from "./memory-contract";
import type { DistillObservation } from "./memory-distiller";
import {
  createDistillInput,
  createMemoryDistiller as createMemoryDistillerWithDeps,
  DISTILLER_PROMPT,
  parseObservationToolCall,
  renderKnownFacts,
  selectKnownFactsWithinBudget,
  selectSupersessionCandidates,
  validateSupersedes,
} from "./memory-distiller";

const testPolicy = createMemoryPolicy({ messageThreshold: 1, maxOutputTokens: 200 });
const testEmbedding = new Float32Array([0.1, 0.2, 0.3]);

function createMemoryDistiller(deps: Parameters<typeof createMemoryDistillerWithDeps>[0] = {}) {
  return createMemoryDistillerWithDeps({ embed: async () => testEmbedding, ...deps });
}

function createTestDistiller(
  store: MemoryStore & { written: MemoryRecord[]; removed: string[] },
  runner?: (systemPrompt: string, userContent: string) => Promise<DistillObservation[]>,
  options?: { commitScopes?: readonly DistillScope[] },
) {
  return createMemoryDistiller({ store, runner, policy: testPolicy, ...options });
}

type RetireCall = { ids: readonly string[]; disposition: MemoryDisposition };

function createMockStore(records: MemoryRecord[] = []): MemoryStore & {
  written: MemoryRecord[];
  removed: string[];
  retired: RetireCall[];
  touched: string[];
} {
  const written: MemoryRecord[] = [];
  const removed: string[] = [];
  const retired: RetireCall[] = [];
  const touched: string[] = [];
  return {
    storage: "sqlite",
    written,
    removed,
    retired,
    touched,
    async list(options?: { scopeKey?: string }) {
      return records.filter((r) => !options?.scopeKey || r.scopeKey === options.scopeKey);
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
    async retire(ids, disposition) {
      retired.push({ ids, disposition });
      const present = ids.filter((id) => records.some((r) => r.id === id));
      for (const id of present) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx >= 0) records.splice(idx, 1);
      }
      return present;
    },
    async listArchive() {
      return [];
    },
    async restore() {
      return [];
    },
    async touchRecalled(ids) {
      touched.push(...ids);
    },
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
    await distiller.commit({
      model: "openai/gpt-5-mini",
      sessionId: "sess_test0001",
      messages: turnOne,
      output: "done one",
    });
    await distiller.commit({
      model: "openai/gpt-5-mini",
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
        return [{ kind: "finding", scope: "session", content: "a durable fact", topic: null, supersedes: [] }];
      },
      policy: testPolicy,
    });
    await expect(
      distiller.commit({
        model: "openai/gpt-5-mini",
        sessionId: "sess_test0001",
        messages: turnOne,
        output: "done one",
      }),
    ).rejects.toThrow();
    failWrite = false;
    await distiller.commit({
      model: "openai/gpt-5-mini",
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
    await distiller.commit({
      model: "openai/gpt-5-mini",
      sessionId: "sess_test0001",
      messages: turnOne,
      output: "done",
    });
    await distiller.commit({
      model: "openai/gpt-5-mini",
      sessionId: "sess_test0002",
      messages: turnOne,
      output: "done",
    });
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
      model: "openai/gpt-5-mini",
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

  test("a failed commit leaves its messages for the next one to read again", async () => {
    const seen: string[] = [];
    const capture = captureRunner(seen);
    let fail = true;
    const distiller = createMemoryDistiller({
      store: createMockStore(),
      runner: async (systemPrompt, userContent) => {
        if (fail) throw new Error("the distiller's answer was not readable");
        return capture(systemPrompt, userContent);
      },
      policy: createMemoryPolicy({ messageThreshold: 1 }),
    });
    const messages = [
      { role: "user", content: "the turn that failed" },
      { role: "assistant", content: "its answer" },
    ];

    await expect(
      distiller.commit({ model: "openai/gpt-5-mini", sessionId: "sess_test0003", messages, output: "done" }),
    ).rejects.toThrow();

    fail = false;
    await distiller.commit({
      model: "openai/gpt-5-mini",
      sessionId: "sess_test0003",
      messages: [...messages, { role: "user", content: "the turn after" }],
      output: "done",
    });
    expect(seen[0]).toContain("the turn that failed");
  });
});

describe("memoryDistiller", () => {
  describe("commit", () => {
    test("skips when no sessionId", async () => {
      const store = createMockStore();
      const source = createTestDistiller(
        store,
        makeRunner([{ kind: "finding", scope: "session", content: "a fact", topic: null, supersedes: [] }]),
      );
      await source.commit({
        model: "openai/gpt-5-mini",
        messages: Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `msg ${i}` })),
        output: "response",
      });
      expect(store.written).toHaveLength(0);
    });

    test("skips when messages below threshold", async () => {
      const store = createMockStore();
      const source = createMemoryDistiller({
        store,
        runner: makeRunner([{ kind: "finding", scope: "session", content: "a fact", topic: null, supersedes: [] }]),
        policy: createMemoryPolicy({ messageThreshold: 5 }),
      });
      await source.commit({
        model: "openai/gpt-5-mini",
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
          content: "prefers short answers",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 6,
        },
        {
          id: "mem_obs_newer",
          scopeKey: "sess_test0001",
          content: "the build runs on bun",
          createdAt: "2026-03-04T11:00:00.000Z",
          tokenEstimate: 6,
        },
      ]);
      const source = createTestDistiller(
        store,
        makeRunner([
          { kind: "finding", scope: "session", content: "prefers short answers", topic: null, supersedes: [] },
        ]),
      );
      await source.commit({
        model: "openai/gpt-5-mini",
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      expect(store.written).toHaveLength(0);
    });

    test("reports retrieved candidates and distill tokens when the turn establishes nothing", async () => {
      const store = createMockStore([
        {
          id: "mem_known00001",
          scopeKey: "sess_test0001",
          content: "the project uses Bun",
          createdAt: "2026-03-04T10:00:00.000Z",
          tokenEstimate: 5,
        },
      ]);
      const source = createTestDistiller(store, makeRunner([]));
      const metrics = await source.commit({
        model: "openai/gpt-5-mini",
        sessionId: "sess_test0001",
        resourceId: "proj_abc123",
        messages: [{ role: "user", content: "hello" }],
        output: "Hello.",
      });
      expect(store.written).toHaveLength(0);
      expect(metrics).toMatchObject({
        projectPromotedFacts: 0,
        userPromotedFacts: 0,
        sessionScopedFacts: 0,
        supersededFacts: 0,
        candidateCount: 1,
      });
      expect(metrics?.distillTokens).toBeGreaterThan(0);
    });

    test("stores topic on observations", async () => {
      const store = createMockStore();
      const source = createTestDistiller(
        store,
        makeRunner([
          { kind: "finding", scope: "project", content: "project uses Vitest", topic: "testing", supersedes: [] },
          { kind: "finding", scope: "project", content: "repo has 18k lines of code", topic: null, supersedes: [] },
        ]),
      );
      await source.commit({
        model: "openai/gpt-5-mini",
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

    test("counts a fact the workspace had no scope to key, rather than losing it silently", async () => {
      const store = createMockStore();
      const source = createTestDistiller(
        store,
        makeRunner([{ kind: "finding", scope: "project", content: "repo uses Bun", topic: null, supersedes: [] }]),
      );
      const metrics = await source.commit({
        model: "openai/gpt-5-mini",
        sessionId: "sess_test0001",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });
      expect(store.written).toHaveLength(0);
      expect(metrics?.droppedUntaggedFacts).toBe(1);
    });

    test("session commit promotes project and user observations to scoped stores", async () => {
      const store = createMockStore();
      const source = createTestDistiller(
        store,
        makeRunner([
          { kind: "finding", scope: "project", content: "repo uses Bun", topic: null, supersedes: [] },
          { kind: "preference", scope: "user", content: "prefers short answers", topic: null, supersedes: [] },
          { kind: "finding", scope: "session", content: "fix failing tests", topic: null, supersedes: [] },
        ]),
      );
      await source.commit({
        model: "openai/gpt-5-mini",
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
          { kind: "finding", scope: "project", content: "project fact one", topic: null, supersedes: [] },
          { kind: "finding", scope: "project", content: "project fact two", topic: null, supersedes: [] },
          { kind: "preference", scope: "user", content: "user fact one", topic: null, supersedes: [] },
          { kind: "finding", scope: "session", content: "session fact one", topic: null, supersedes: [] },
          { kind: "finding", scope: "project", content: "project fact three", topic: null, supersedes: [] },
        ]),
      );
      const metrics = await source.commit({
        model: "openai/gpt-5-mini",
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

    test("commitScopes drops an observation for a scope it does not name", async () => {
      const store = createMockStore();
      const source = createMemoryDistiller({
        store,
        runner: makeRunner([
          { kind: "finding", scope: "project", content: "a project fact", topic: null, supersedes: [] },
          { kind: "finding", scope: "session", content: "a session fact", topic: null, supersedes: [] },
          { kind: "preference", scope: "user", content: "a user fact", topic: null, supersedes: [] },
        ]),
        policy: testPolicy,
        commitScopes: ["project"],
      });
      await source.commit({
        model: "openai/gpt-5-mini",
        sessionId: "sess_test0001",
        resourceId: "proj_abc123",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });

      expect(store.written).toHaveLength(1);
      const keys = store.written.map((entry) => entry.scopeKey);
      expect(keys.some((key) => key.startsWith("proj_"))).toBe(true);
      expect(keys.some((key) => key === "sess_test0001")).toBe(false);
      expect(keys.some((key) => key.startsWith("user_"))).toBe(false);
    });

    test("commits nothing to project scope in a workspace with no remote", async () => {
      const store = createMockStore();
      const source = createMemoryDistiller({
        store,
        runner: makeRunner([
          { kind: "finding", scope: "project", content: "a project fact", topic: null, supersedes: [] },
        ]),
        policy: testPolicy,
      });
      await source.commit({
        model: "openai/gpt-5-mini",
        sessionId: "sess_test0001",
        workspace: "/tmp/acolyte-project",
        messages: [{ role: "user", content: "hello" }],
        output: "done",
      });

      expect(store.written).toEqual([]);
    });

    test("quality fixtures classify observations into the right scopes", async () => {
      const fixturePolicy = createMemoryPolicy({ messageThreshold: 1, maxOutputTokens: 10_000 });
      const fixtures = [
        {
          name: "good_scoped_output",
          observations: [
            {
              kind: "finding" as const,
              scope: "project" as const,
              content: "uses bun test",
              topic: null,
              supersedes: [],
            },
            {
              kind: "preference" as const,
              scope: "user" as const,
              content: "prefers concise responses",
              topic: null,
              supersedes: [],
            },
            {
              kind: "finding" as const,
              scope: "session" as const,
              content: "fixing failing memory tests",
              topic: null,
              supersedes: [],
            },
            {
              kind: "finding" as const,
              scope: "session" as const,
              content: "stabilize memory quality",
              topic: null,
              supersedes: [],
            },
            {
              kind: "finding" as const,
              scope: "session" as const,
              content: "add regression coverage",
              topic: null,
              supersedes: [],
            },
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
          observations: [
            {
              kind: "finding" as const,
              scope: "project" as const,
              content: "uses bun test",
              topic: null,
              supersedes: [],
            },
          ],
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
          model: "openai/gpt-5-mini",
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

describe("validateSupersedes", () => {
  const shown: MemoryRecord[] = [
    {
      id: "mem_shown00001",
      scopeKey: "proj_abc123",
      content: "a project fact",
      createdAt: "2026-03-04T10:00:00.000Z",
      tokenEstimate: 3,
    },
    {
      id: "mem_shown00002",
      scopeKey: "user_abc123",
      content: "a user fact",
      createdAt: "2026-03-04T10:00:00.000Z",
      tokenEstimate: 3,
    },
  ];

  test("keeps an id that was shown in the target scope", () => {
    expect(validateSupersedes(["mem_shown00001"], shown, "proj_abc123")).toEqual(["mem_shown00001"]);
  });

  test("drops an id that was never shown", () => {
    expect(validateSupersedes(["mem_neverseen1"], shown, "proj_abc123")).toEqual([]);
  });

  test("drops a shown id belonging to another scope", () => {
    expect(validateSupersedes(["mem_shown00002"], shown, "proj_abc123")).toEqual([]);
  });

  test("deduplicates repeated ids", () => {
    expect(validateSupersedes(["mem_shown00001", "mem_shown00001"], shown, "proj_abc123")).toEqual(["mem_shown00001"]);
  });
});

describe("renderKnownFacts", () => {
  test("renders nothing when there are no candidates", () => {
    expect(renderKnownFacts([])).toBe("");
  });

  test("names each candidate with its id and scope", () => {
    const rendered = renderKnownFacts([
      {
        id: "mem_known00001",
        scopeKey: "proj_abc123",
        content: "the build runs on bun",
        createdAt: "2026-03-04T10:00:00.000Z",
        tokenEstimate: 5,
      },
    ]);
    expect(rendered).toBe("known:\nmem_known00001 (project): the build runs on bun");
  });
});

describe("selectKnownFactsWithinBudget", () => {
  test("keeps complete entries within the candidate token budget", () => {
    const candidates = [
      {
        id: "mem_large00001",
        scopeKey: "proj_abc123",
        content: "large ".repeat(1_000),
        createdAt: "2026-03-04T10:00:00.000Z",
        tokenEstimate: 1_000,
      },
      {
        id: "mem_small00001",
        scopeKey: "proj_abc123",
        content: "small fact",
        createdAt: "2026-03-04T10:00:00.000Z",
        tokenEstimate: 2,
      },
    ];

    expect(selectKnownFactsWithinBudget(candidates, 20).map((record) => record.id)).toEqual(["mem_small00001"]);
  });
});

describe("supersession", () => {
  const existing: MemoryRecord = {
    id: "mem_stale00001",
    scopeKey: "proj_abc123",
    content: "the terminal-step backstop lives somewhere in lifecycle",
    createdAt: "2026-03-04T10:00:00.000Z",
    tokenEstimate: 8,
  };
  const commitCtx = {
    model: "openai/gpt-5-mini",
    sessionId: "sess_test0001",
    resourceId: "proj_abc123" as const,
    messages: [{ role: "user", content: "hello" }],
    output: "done",
  };

  test("distills with the model the turn ran with, not a configured one", async () => {
    const store = createMockStore();
    let seenModel = "";
    const distiller = createMemoryDistiller({
      store,
      policy: testPolicy,
      runner: async (_prompt, _content, model) => {
        seenModel = model;
        return [];
      },
    });

    await distiller.commit({ ...commitCtx, model: "anthropic/claude-sonnet-4" });

    expect(seenModel).toBe("anthropic/claude-sonnet-4");
  });

  test("shows existing facts to the distiller with their ids", async () => {
    const store = createMockStore([{ ...existing }]);
    let seen = "";
    const distiller = createMemoryDistiller({
      store,
      runner: async (_prompt, userContent) => {
        seen = userContent;
        return [];
      },
      policy: testPolicy,
    });
    await distiller.commit(commitCtx);
    expect(seen).toContain("known:");
    expect(seen).toContain("mem_stale00001");
  });

  test("retires a superseded fact naming the new record as its successor", async () => {
    const store = createMockStore([{ ...existing }]);
    const distiller = createMemoryDistiller({
      store,
      runner: makeRunner([
        {
          kind: "finding",
          scope: "project",
          content: "src/lifecycle-completion.ts owns the terminal-step backstop",
          topic: "lifecycle",
          supersedes: ["mem_stale00001"],
        },
      ]),
      policy: testPolicy,
    });
    const metrics = await distiller.commit(commitCtx);

    expect(store.retired).toHaveLength(1);
    expect(store.retired[0]?.ids).toEqual(["mem_stale00001"]);
    const successor = store.written.find((r) => r.content.startsWith("src/lifecycle-completion.ts"));
    expect(successor).toBeDefined();
    expect(store.retired[0]?.disposition).toEqual({ kind: "superseded", by: [successor?.id ?? ""] });
    expect(metrics?.supersededFacts).toBe(1);
  });

  test("ignores a supersession naming a record the distiller was not shown", async () => {
    const store = createMockStore([{ ...existing }]);
    const distiller = createMemoryDistiller({
      store,
      runner: makeRunner([
        {
          kind: "finding",
          scope: "project",
          content: "a brand new project fact",
          topic: null,
          supersedes: ["mem_neverseen1"],
        },
      ]),
      policy: testPolicy,
    });
    const metrics = await distiller.commit(commitCtx);
    expect(store.retired).toHaveLength(0);
    expect(metrics?.supersededFacts).toBe(0);
  });

  test("ignores a supersession that crosses scopes", async () => {
    const store = createMockStore([{ ...existing }]);
    const distiller = createMemoryDistiller({
      store,
      runner: makeRunner([
        {
          kind: "preference",
          scope: "user",
          content: "prefers short answers",
          topic: null,
          supersedes: ["mem_stale00001"],
        },
      ]),
      policy: testPolicy,
    });
    const metrics = await distiller.commit(commitCtx);
    expect(store.retired).toHaveLength(0);
    expect(metrics?.supersededFacts).toBe(0);
  });

  test("retires nothing when the successor was deduplicated away", async () => {
    const store = createMockStore([{ ...existing }]);
    const distiller = createMemoryDistiller({
      store,
      runner: makeRunner([
        { kind: "finding", scope: "project", content: existing.content, topic: null, supersedes: ["mem_stale00001"] },
      ]),
      policy: testPolicy,
    });
    await distiller.commit(commitCtx);
    expect(store.written).toHaveLength(0);
    expect(store.retired).toHaveLength(0);
  });

  test("merges several facts into one successor", async () => {
    const second: MemoryRecord = { ...existing, id: "mem_stale00002", content: "the backstop classifies finishReason" };
    const store = createMockStore([{ ...existing }, second]);
    const distiller = createMemoryDistiller({
      store,
      runner: makeRunner([
        {
          kind: "finding",
          scope: "project",
          content: "src/lifecycle-completion.ts owns the backstop and classifies finishReason",
          topic: null,
          supersedes: ["mem_stale00001", "mem_stale00002"],
        },
      ]),
      policy: testPolicy,
    });
    const metrics = await distiller.commit(commitCtx);
    const successor = store.written[0]?.id ?? "";
    expect(store.retired.flatMap((call) => [...call.ids])).toEqual(["mem_stale00001", "mem_stale00002"]);
    for (const call of store.retired) {
      expect(call.disposition).toEqual({ kind: "superseded", by: [successor] });
    }
    expect(metrics?.supersededFacts).toBe(2);
  });

  test("a split names every successor in the retired record's lineage", async () => {
    const store = createMockStore([{ ...existing, content: "the backstop classifies and reopens" }]);
    const distiller = createMemoryDistiller({
      store,
      runner: makeRunner([
        {
          kind: "finding",
          scope: "project",
          content: "the backstop classifies the terminal step",
          topic: null,
          supersedes: ["mem_stale00001"],
        },
        {
          kind: "finding",
          scope: "project",
          content: "the backstop reopens once per reason",
          topic: null,
          supersedes: ["mem_stale00001"],
        },
      ]),
      policy: testPolicy,
    });
    const metrics = await distiller.commit(commitCtx);

    expect(store.written).toHaveLength(2);
    expect(store.retired).toHaveLength(1);
    expect(store.retired[0]?.ids).toEqual(["mem_stale00001"]);
    expect(store.retired[0]?.disposition).toEqual({
      kind: "superseded",
      by: store.written.map((r) => r.id),
    });
    expect(metrics?.supersededFacts).toBe(1);
  });

  test("a deduplicated write is not counted as promoted", async () => {
    const store = createMockStore([{ ...existing }]);
    const distiller = createMemoryDistiller({
      store,
      runner: makeRunner([
        { kind: "finding", scope: "project", content: existing.content, topic: null, supersedes: [] },
      ]),
      policy: testPolicy,
    });
    const metrics = await distiller.commit(commitCtx);
    expect(store.written).toHaveLength(0);
    expect(metrics?.projectPromotedFacts).toBe(0);
  });

  test("a retirement failure keeps the facts the turn established", async () => {
    const store = createMockStore([{ ...existing }]);
    store.retire = async () => {
      throw new Error("archive unavailable");
    };
    const distiller = createMemoryDistiller({
      store,
      runner: makeRunner([
        {
          kind: "finding",
          scope: "project",
          content: "a sharper version of the fact",
          topic: null,
          supersedes: ["mem_stale00001"],
        },
      ]),
      policy: testPolicy,
    });
    const metrics = await distiller.commit(commitCtx);
    expect(store.written).toHaveLength(1);
    expect(metrics?.projectPromotedFacts).toBe(1);
    expect(metrics?.supersededFacts).toBe(0);
  });

  test("the candidate limit comes from policy", async () => {
    const store = createMockStore(
      Array.from({ length: 5 }, (_, i) => ({ ...existing, id: `mem_many0000${i}`, content: `fact ${i}` })),
    );
    let seen = "";
    const distiller = createMemoryDistiller({
      store,
      runner: async (_prompt, userContent) => {
        seen = userContent;
        return [];
      },
      policy: createMemoryPolicy({ messageThreshold: 1, recallCandidateLimit: 2 }),
    });
    await distiller.commit(commitCtx);
    expect(seen).toContain("mem_many00000");
    expect(seen).not.toContain("mem_many00002");
  });

  test("reading the corpus to supersede does not count as recalling it", async () => {
    const store = createMockStore([{ ...existing }]);
    const distiller = createMemoryDistiller({ store, runner: makeRunner([]), policy: testPolicy });
    await distiller.commit(commitCtx);
    expect(store.touched).toEqual([]);
  });

  test("a candidate lookup failure yields no candidates rather than throwing", async () => {
    const store = createMockStore([{ ...existing }]);
    store.list = async () => {
      throw new Error("store unreachable");
    };
    const candidates = await selectSupersessionCandidates(commitCtx, "any query", { store, policy: testPolicy });
    expect(candidates).toEqual([]);
  });
});

describe("parseObservationToolCall", () => {
  const call = (...facts: unknown[]) => parseObservationToolCall({ input: JSON.stringify({ facts }) });

  test("a well-formed call becomes an observation", () => {
    expect(call({ kind: "finding", scope: "project", content: "the loader owns retries", topic: "Loader" })).toEqual([
      {
        kind: "finding",
        scope: "project",
        content: "the loader owns retries",
        topic: "loader",
        supersedes: [],
      },
    ]);
  });

  test("an entry names which kind of fact it is, and one outside the four rejects the call", () => {
    expect(call({ scope: "project", content: "a fact with no kind" })).toEqual([]);
    expect(call({ kind: "change", scope: "project", content: "renamed the flag" })).toEqual([]);
    expect(call({ kind: "decision", scope: "project", content: "imports spend oldest-first" })[0]?.kind).toBe(
      "decision",
    );
  });

  test("one call carries every fact a turn established", () => {
    expect(
      call(
        { kind: "finding", scope: "project", content: "omp and pi share a transcript format" },
        { kind: "finding", scope: "project", content: "opencode stores sessions in sqlite" },
        { kind: "preference", scope: "user", content: "he wants provider setup outside the TUI" },
      ).map((observation) => observation.content),
    ).toEqual([
      "omp and pi share a transcript format",
      "opencode stores sessions in sqlite",
      "he wants provider setup outside the TUI",
    ]);
  });

  test("a blank topic is kept as an observation with no topic", () => {
    expect(call({ kind: "finding", scope: "project", content: "the loader owns retries", topic: "" })).toEqual([
      {
        kind: "finding",
        scope: "project",
        content: "the loader owns retries",
        topic: null,
        supersedes: [],
      },
    ]);
  });

  test("a call with no facts records nothing", () => {
    expect(parseObservationToolCall({ input: JSON.stringify({ facts: [] }) })).toEqual([]);
  });

  test("an answer that cannot be read fails rather than passing for silence", () => {
    expect(() => parseObservationToolCall({ input: "not json" })).toThrow(
      expect.objectContaining({ code: "E_DISTILL_UNREADABLE" }),
    );
    expect(() =>
      parseObservationToolCall({ input: JSON.stringify({ kind: "finding", scope: "project", content: "unwrapped" }) }),
    ).toThrow(expect.objectContaining({ code: "E_DISTILL_UNREADABLE" }));
  });

  test("a fact the envelope carries but the schema rejects costs only itself", () => {
    expect(call({ kind: "finding", content: "no scope given" })).toEqual([]);
    expect(call({ kind: "finding", scope: "elsewhere", content: "an unknown scope" })).toEqual([]);
    expect(call({ kind: "finding", scope: "project", content: "   " })).toEqual([]);
  });

  test("one malformed fact costs only itself", () => {
    expect(
      call(
        { kind: "finding", scope: "project", content: "a good fact" },
        { scope: "elsewhere", content: "a bad one" },
        { kind: "decision", scope: "user", content: "another good fact" },
      ).map((observation) => observation.content),
    ).toEqual(["a good fact", "another good fact"]);
  });

  test("a batch of nothing but malformed facts yields no observation", () => {
    expect(call({ scope: "elsewhere", content: "a bad one" }, { kind: "finding", content: "no scope" })).toEqual([]);
  });

  test("a non-array supersedes yields no observation", () => {
    expect(call({ kind: "finding", scope: "project", content: "a fact", supersedes: "mem_one000001" })).toEqual([]);
    expect(call({ kind: "finding", scope: "project", content: "a fact", supersedes: [1] })).toEqual([]);
  });

  test("supersedes ids are trimmed and deduplicated", () => {
    expect(
      call({
        kind: "finding",
        scope: "project",
        content: "a fact",
        supersedes: [" mem_one000001 ", "mem_one000001", "  ", "mem_two000002"],
      })[0]?.supersedes,
    ).toEqual(["mem_one000001", "mem_two000002"]);
  });

  test("a blank topic becomes no topic", () => {
    expect(call({ kind: "preference", scope: "user", content: "a fact", topic: "   " })[0]?.topic).toBeNull();
  });
});
