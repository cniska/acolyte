import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CloudApiError } from "./cloud-client";
import { migrateLocalDataToCloud } from "./cloud-migrate";
import { setLogSink } from "./log";
import type { MemoryArchiveRecord, MemoryDisposition, MemoryRecord, MemoryStore } from "./memory-contract";
import type { Session, SessionId, SessionStore } from "./session-contract";
import { createSession } from "./test-utils";

function createRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: overrides.id ?? "mem_aaaaaaa1",
    scopeKey: overrides.scopeKey ?? "proj_abc123",
    kind: overrides.kind ?? "observation",
    content: overrides.content ?? "A durable fact.",
    createdAt: overrides.createdAt ?? "2026-08-01T10:00:00.000Z",
    tokenEstimate: overrides.tokenEstimate ?? 5,
    topic: overrides.topic ?? null,
  };
}

type FakeMemoryStore = MemoryStore & {
  written: { record: MemoryRecord; scope?: string }[];
  embeddings: { id: string; scopeKey: string }[];
  retired: { ids: string[]; disposition: MemoryDisposition }[];
};

function createFakeMemoryStore(options: {
  records?: MemoryRecord[];
  archive?: MemoryArchiveRecord[];
  embeddingsFor?: string[];
  failWriteFor?: string[];
  failEmbeddingFor?: string[];
  rejectTokenFor?: string[];
}): FakeMemoryStore {
  const written: { record: MemoryRecord; scope?: string }[] = [];
  const embeddings: { id: string; scopeKey: string }[] = [];
  const retired: { ids: string[]; disposition: MemoryDisposition }[] = [];
  const store = {
    storage: "sqlite" as const,
    written,
    embeddings,
    retired,
    list: async () => options.records ?? [],
    listArchive: async () => options.archive ?? [],
    write: async (record: MemoryRecord, scope?: string) => {
      if (options.rejectTokenFor?.includes(record.id)) throw new CloudApiError(401, "unauthorized");
      if (options.failWriteFor?.includes(record.id)) throw new Error("write refused");
      written.push({ record, scope });
    },
    writeEmbedding: async (id: string, scopeKey: string) => {
      if (options.failEmbeddingFor?.includes(id)) throw new Error("embedding refused");
      embeddings.push({ id, scopeKey });
    },
    getEmbedding: async (id: string) =>
      options.embeddingsFor?.includes(id) ? Buffer.from(new Float32Array([0.5]).buffer) : null,
    retire: async (ids: string[], disposition: MemoryDisposition) => {
      retired.push({ ids, disposition });
      return ids;
    },
    remove: async () => {},
    restore: async () => [],
    touchRecalled: async () => {},
    removeEmbedding: async () => {},
    getEmbeddings: async () => new Map(),
    close: () => {},
  };
  return store as unknown as FakeMemoryStore;
}

type FakeSessionStore = SessionStore & { saved: Session[] };

function createFakeSessionStore(sessions: Session[], failFor: SessionId[] = []): FakeSessionStore {
  const saved: Session[] = [];
  const store = {
    saved,
    listSessions: async () => sessions,
    saveSession: async (session: Session) => {
      if (failFor.includes(session.id)) throw new Error("save refused");
      saved.push(session);
    },
    getSession: async () => null,
    removeSession: async () => {},
    getActiveSessionId: async () => undefined,
    setActiveSessionId: async () => {},
    searchSession: async () => [],
    close: () => {},
  };
  return store as unknown as FakeSessionStore;
}

describe("migrateLocalDataToCloud", () => {
  let logLines: string[] = [];

  beforeEach(() => {
    logLines = [];
    setLogSink((line) => logLines.push(line));
  });

  afterEach(() => {
    setLogSink(null);
  });

  test("copies durable records with their embeddings", async () => {
    const local = createFakeMemoryStore({
      records: [createRecord({ id: "mem_proj0001" }), createRecord({ id: "mem_user0001", scopeKey: "user_abc123" })],
      embeddingsFor: ["mem_proj0001"],
    });
    const cloud = createFakeMemoryStore({});

    const summary = await migrateLocalDataToCloud({
      localMemory: local,
      localSessions: createFakeSessionStore([]),
      cloudMemory: cloud,
      cloudSessions: createFakeSessionStore([]),
    });

    expect(summary.memories).toBe(2);
    expect(cloud.written.map((entry) => entry.record.id)).toEqual(["mem_proj0001", "mem_user0001"]);
    expect(cloud.written.map((entry) => entry.scope)).toEqual(["project", "user"]);
    expect(cloud.embeddings).toEqual([{ id: "mem_proj0001", scopeKey: "proj_abc123" }]);
  });

  test("leaves session-scoped and unrecognized records behind", async () => {
    const local = createFakeMemoryStore({
      records: [
        createRecord({ id: "mem_sess0001", scopeKey: "sess_abc123" }),
        createRecord({ id: "mem_odd00001", scopeKey: "team_abc123" }),
        createRecord({ id: "mem_proj0001" }),
      ],
    });
    const cloud = createFakeMemoryStore({});

    const summary = await migrateLocalDataToCloud({
      localMemory: local,
      localSessions: createFakeSessionStore([]),
      cloudMemory: cloud,
      cloudSessions: createFakeSessionStore([]),
    });

    expect(summary.memories).toBe(1);
    expect(cloud.written.map((entry) => entry.record.id)).toEqual(["mem_proj0001"]);
  });

  test("leaves the archive behind", async () => {
    const archived: MemoryArchiveRecord = {
      ...createRecord({ id: "mem_gone0001" }),
      retiredAt: "2026-08-02T10:00:00.000Z",
      disposition: { kind: "superseded", by: ["mem_new00001"] },
    };
    const local = createFakeMemoryStore({ archive: [archived], embeddingsFor: ["mem_gone0001"] });
    const cloud = createFakeMemoryStore({});

    const summary = await migrateLocalDataToCloud({
      localMemory: local,
      localSessions: createFakeSessionStore([]),
      cloudMemory: cloud,
      cloudSessions: createFakeSessionStore([]),
    });

    expect(summary.memories).toBe(0);
    expect(cloud.written).toEqual([]);
    expect(cloud.retired).toEqual([]);
    expect(cloud.embeddings).toEqual([]);
  });

  test("copies sessions", async () => {
    const sessions = [createSession({ id: "sess_one" }), createSession({ id: "sess_two" })];
    const cloudSessions = createFakeSessionStore([]);

    const summary = await migrateLocalDataToCloud({
      localMemory: createFakeMemoryStore({}),
      localSessions: createFakeSessionStore(sessions),
      cloudMemory: createFakeMemoryStore({}),
      cloudSessions,
    });

    expect(summary.sessions).toBe(2);
    expect(cloudSessions.saved.map((session) => session.id)).toEqual(["sess_one", "sess_two"]);
  });

  test("counts a rejected write and keeps copying the rest", async () => {
    const local = createFakeMemoryStore({
      records: [createRecord({ id: "mem_bad00001" }), createRecord({ id: "mem_good0001" })],
    });
    const cloud = createFakeMemoryStore({ failWriteFor: ["mem_bad00001"] });

    const summary = await migrateLocalDataToCloud({
      localMemory: local,
      localSessions: createFakeSessionStore([createSession({ id: "sess_one" })]),
      cloudMemory: cloud,
      cloudSessions: createFakeSessionStore([], ["sess_one" as SessionId]),
    });

    expect(summary.failures).toBe(2);
    expect(summary.memories).toBe(1);
    expect(summary.sessions).toBe(0);
    expect(cloud.written.map((entry) => entry.record.id)).toEqual(["mem_good0001"]);
  });

  test("names every skipped record and session in the log", async () => {
    await migrateLocalDataToCloud({
      localMemory: createFakeMemoryStore({
        records: [createRecord({ id: "mem_bad00001" }), createRecord({ id: "mem_novec0001" })],
        embeddingsFor: ["mem_novec0001"],
      }),
      localSessions: createFakeSessionStore([createSession({ id: "sess_one" })]),
      cloudMemory: createFakeMemoryStore({
        failWriteFor: ["mem_bad00001"],
        failEmbeddingFor: ["mem_novec0001"],
      }),
      cloudSessions: createFakeSessionStore([], ["sess_one" as SessionId]),
    });

    const logged = logLines.join("");
    expect(logged).toContain("cloud.migrate.memory_failed");
    expect(logged).toContain("mem_bad00001");
    expect(logged).toContain("cloud.migrate.embedding_failed");
    expect(logged).toContain("mem_novec0001");
    expect(logged).toContain("cloud.migrate.session_failed");
    expect(logged).toContain("sess_one");
  });

  test("stops the run when the cloud rejects the token", async () => {
    const local = createFakeMemoryStore({
      records: [createRecord({ id: "mem_proj0001" }), createRecord({ id: "mem_proj0002" })],
    });
    const cloud = createFakeMemoryStore({ rejectTokenFor: ["mem_proj0001"] });

    const run = migrateLocalDataToCloud({
      localMemory: local,
      localSessions: createFakeSessionStore([createSession({ id: "sess_one" })]),
      cloudMemory: cloud,
      cloudSessions: createFakeSessionStore([]),
    });

    await expect(run).rejects.toBeInstanceOf(CloudApiError);
    expect(cloud.written).toEqual([]);
  });

  test("counts a rejected embedding apart from its record", async () => {
    const local = createFakeMemoryStore({
      records: [createRecord({ id: "mem_proj0001" })],
      embeddingsFor: ["mem_proj0001"],
    });
    const cloud = createFakeMemoryStore({ failEmbeddingFor: ["mem_proj0001"] });

    const summary = await migrateLocalDataToCloud({
      localMemory: local,
      localSessions: createFakeSessionStore([]),
      cloudMemory: cloud,
      cloudSessions: createFakeSessionStore([]),
    });

    expect(summary.memories).toBe(1);
    expect(cloud.embeddings).toEqual([]);
    expect(summary.embeddingFailures).toBe(1);
    expect(summary.failures).toBe(0);
  });
});
