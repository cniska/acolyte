import { describe, expect, test } from "bun:test";
import { migrateLocalDataToCloud } from "./cloud-migrate";
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
    expect(summary.embeddings).toBe(1);
    expect(cloud.written.map((entry) => entry.record.id)).toEqual(["mem_proj0001", "mem_user0001"]);
    expect(cloud.written.map((entry) => entry.scope)).toEqual(["project", "user"]);
    expect(cloud.embeddings).toEqual([{ id: "mem_proj0001", scopeKey: "proj_abc123" }]);
  });

  test("leaves session-scoped records behind", async () => {
    const local = createFakeMemoryStore({
      records: [createRecord({ id: "mem_sess0001", scopeKey: "sess_abc123" }), createRecord({ id: "mem_proj0001" })],
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

  test("recreates an archived record by retiring it with its own disposition", async () => {
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

    expect(summary.archived).toBe(1);
    expect(cloud.retired).toEqual([
      { ids: ["mem_gone0001"], disposition: { kind: "superseded", by: ["mem_new00001"] } },
    ]);
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
    expect(summary.embeddings).toBe(0);
    expect(summary.embeddingFailures).toBe(1);
    expect(summary.failures).toBe(0);
  });

  test("reports progress once per record, archive row, and session", async () => {
    const progress: string[] = [];

    await migrateLocalDataToCloud({
      localMemory: createFakeMemoryStore({
        records: [createRecord({ id: "mem_proj0001" })],
        archive: [
          {
            ...createRecord({ id: "mem_gone0001" }),
            retiredAt: "2026-08-02T10:00:00.000Z",
            disposition: { kind: "noise" },
          },
        ],
      }),
      localSessions: createFakeSessionStore([createSession({ id: "sess_one" })]),
      cloudMemory: createFakeMemoryStore({}),
      cloudSessions: createFakeSessionStore([]),
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });

    expect(progress).toEqual(["1/3", "2/3", "3/3"]);
  });
});
