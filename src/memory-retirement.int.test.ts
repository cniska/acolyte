import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type FakeProviderServer, startFakeProviderServer } from "../scripts/fake-provider-server";
import type { MemoryRecord } from "./memory-contract";
import { embeddingToBuffer } from "./memory-embedding";
import { restoreMemories, retireMemories } from "./memory-ops";
import { createSqliteMemoryStore } from "./memory-store";
import { defaultUserResourceId } from "./resource-id";
import { pinEmbeddingProviders } from "./test-utils";

let fake: FakeProviderServer;
let restoreProviders: () => void;

beforeAll(() => {
  fake = startFakeProviderServer();
  restoreProviders = pinEmbeddingProviders({
    embeddingModel: "openai/text-embedding-3-large",
    openai: { apiKey: "fake-key", baseUrl: fake.baseUrl },
  });
});
afterAll(() => {
  fake.stop();
  restoreProviders();
});

const scopeKey = defaultUserResourceId();

function record(id: string, content: string): MemoryRecord {
  return {
    id,
    scopeKey,
    kind: "observation",
    content,
    createdAt: "2026-03-05T10:00:00.000Z",
    tokenEstimate: 2,
  };
}

describe("retirement embedding lifecycle", () => {
  test("retiring drops the embedding and restoring regenerates it", async () => {
    const store = createSqliteMemoryStore(":memory:");
    await store.write(record("mem_embedded01", "a recallable fact"));
    await store.writeEmbedding("mem_embedded01", scopeKey, embeddingToBuffer(new Float32Array([0.4, 0.5, 0.6])));
    expect(await store.getEmbedding("mem_embedded01")).not.toBeNull();

    await retireMemories(["mem_embedded01"], { kind: "noise" }, { store });
    expect(await store.getEmbedding("mem_embedded01")).toBeNull();

    await restoreMemories(["mem_embedded01"], { store });
    const regenerated = await store.getEmbedding("mem_embedded01");
    expect(regenerated).not.toBeNull();
    if (!regenerated) throw new Error("expected a regenerated embedding");
    const vec = new Float32Array(regenerated.buffer, regenerated.byteOffset, regenerated.byteLength / 4);
    expect(vec).toHaveLength(64);
    store.close();
  });

  test("restoring an id that was never archived writes no embedding", async () => {
    const store = createSqliteMemoryStore(":memory:");
    await restoreMemories(["mem_neverthere"], { store });
    expect(await store.getEmbedding("mem_neverthere")).toBeNull();
    store.close();
  });
});

describe("archive schema constraints", () => {
  function archiveDb(): { db: Database; close: () => void } {
    const path = join(mkdtempSync(join(tmpdir(), "acolyte-archive-")), "memory.db");
    const store = createSqliteMemoryStore(path);
    const db = new Database(path);
    function close(): void {
      db.close();
      store.close();
      rmSync(dirname(path), { recursive: true, force: true });
    }
    return { db, close };
  }

  const columns =
    "(id, scope, scope_key, kind, content, created_at, token_estimate, retired_at, disposition, superseded_by)";

  test("a superseded row cannot exist without successors", () => {
    const { db, close } = archiveDb();
    expect(() =>
      db.run(
        `INSERT INTO memory_archive ${columns}
         VALUES ('mem_bad000001', 'project', 'proj_abc123', 'observation', 'x', '2026-03-04T12:00:00.000Z', 1,
                 '2026-03-05T12:00:00.000Z', 'superseded', NULL)`,
      ),
    ).toThrow();
    close();
  });

  test("a non-superseded row cannot carry successors", () => {
    const { db, close } = archiveDb();
    expect(() =>
      db.run(
        `INSERT INTO memory_archive ${columns}
         VALUES ('mem_bad000002', 'project', 'proj_abc123', 'observation', 'x', '2026-03-04T12:00:00.000Z', 1,
                 '2026-03-05T12:00:00.000Z', 'noise', '["mem_whatever1"]')`,
      ),
    ).toThrow();
    close();
  });

  test("an unknown disposition is rejected", () => {
    const { db, close } = archiveDb();
    expect(() =>
      db.run(
        `INSERT INTO memory_archive ${columns}
         VALUES ('mem_bad000003', 'project', 'proj_abc123', 'observation', 'x', '2026-03-04T12:00:00.000Z', 1,
                 '2026-03-05T12:00:00.000Z', 'banana', NULL)`,
      ),
    ).toThrow();
    close();
  });
});

describe("migration to the archive schema", () => {
  test("upgrades an existing database and keeps its rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-migrate-"));
    const path = join(dir, "memory.db");

    const before = createSqliteMemoryStore(path);
    await before.write(record("mem_preexist01", "a fact from before the upgrade"));
    before.close();

    const raw = new Database(path);
    raw.run("DROP TABLE memory_archive");
    raw.run("UPDATE schema_version SET version = 2");
    raw.close();

    const after = createSqliteMemoryStore(path);
    expect((await after.list({ scopeKey })).map((r) => r.content)).toEqual(["a fact from before the upgrade"]);
    expect(await after.retire(["mem_preexist01"], { kind: "noise" })).toEqual(["mem_preexist01"]);
    expect((await after.listArchive()).map((r) => r.id)).toEqual(["mem_preexist01"]);
    after.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
