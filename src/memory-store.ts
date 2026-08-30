import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Migration, migrateUp } from "./db-migrate";
import { log } from "./log";
import {
  type MemoryArchiveRecord,
  type MemoryRecord,
  type MemoryStore,
  memoryDispositionSchema,
  safeScopeKey,
  scopeFromKey,
} from "./memory-contract";
import { dataDir } from "./paths";

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        token_estimate INTEGER NOT NULL,
        last_recalled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_memories_scope_key ON memories(scope_key);
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_embeddings_scope ON memory_embeddings(scope);
    `,
  },
  {
    version: 2,
    up: `ALTER TABLE memories ADD COLUMN topic TEXT;`,
  },
  {
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS memory_archive (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        token_estimate INTEGER NOT NULL,
        last_recalled_at TEXT,
        topic TEXT,
        retired_at TEXT NOT NULL,
        disposition TEXT NOT NULL CHECK (disposition IN ('superseded', 'capacity', 'noise')),
        superseded_by TEXT CHECK ((disposition = 'superseded') = (superseded_by IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_archive_scope_key ON memory_archive(scope_key);
      CREATE INDEX IF NOT EXISTS idx_archive_disposition ON memory_archive(disposition);
    `,
  },
];

type MemoryRow = {
  id: string;
  scope: string;
  scope_key: string;
  kind: string;
  content: string;
  created_at: string;
  token_estimate: number;
  last_recalled_at: string | null;
  topic: string | null;
};

type ArchiveRow = MemoryRow & {
  retired_at: string;
  disposition: string;
  superseded_by: string | null;
};

function rowToArchiveRecord(row: ArchiveRow): MemoryArchiveRecord {
  const by = row.superseded_by ? (JSON.parse(row.superseded_by) as unknown) : undefined;
  return {
    ...rowToRecord(row),
    retiredAt: row.retired_at,
    disposition: memoryDispositionSchema.parse({ kind: row.disposition, ...(by ? { by } : {}) }),
  };
}

// bun:sqlite hands back a plain Uint8Array for a BLOB, whose `toString("base64")` ignores the
// encoding and yields comma-separated decimal bytes. Callers that serialize an embedding depend on
// the Buffer the store's contract promises, so the view is wrapped without copying its bytes.
function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    scopeKey: row.scope_key,
    kind: row.kind as MemoryRecord["kind"],
    content: row.content,
    createdAt: row.created_at,
    tokenEstimate: row.token_estimate,
    lastRecalledAt: row.last_recalled_at ?? null,
    topic: row.topic ?? null,
  };
}

export function createSqliteMemoryStore(dbPath?: string): MemoryStore {
  const resolvedPath = dbPath ?? join(dataDir(), "memory.db");
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  migrateUp(db, MIGRATIONS);

  const listByScopeStmt = db.prepare<MemoryRow, [string]>(
    "SELECT * FROM memories WHERE scope_key = ? ORDER BY created_at ASC",
  );
  const listByKindStmt = db.prepare<MemoryRow, [string]>(
    "SELECT * FROM memories WHERE kind = ? ORDER BY created_at ASC",
  );
  const listByScopeAndKindStmt = db.prepare<MemoryRow, [string, string]>(
    "SELECT * FROM memories WHERE scope_key = ? AND kind = ? ORDER BY created_at ASC",
  );
  const listAllStmt = db.prepare<MemoryRow, []>("SELECT * FROM memories ORDER BY created_at ASC");
  const writeStmt = db.prepare<void, [string, string, string, string, string, string, number, string | null]>(
    `INSERT OR REPLACE INTO memories (id, scope, scope_key, kind, content, created_at, token_estimate, topic)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const removeStmt = db.prepare<void, [string]>("DELETE FROM memories WHERE id = ?");
  const writeEmbStmt = db.prepare<void, [string, string, Buffer]>(
    "INSERT OR REPLACE INTO memory_embeddings (id, scope, embedding) VALUES (?, ?, ?)",
  );
  const removeEmbStmt = db.prepare<void, [string]>("DELETE FROM memory_embeddings WHERE id = ?");
  const getEmbStmt = db.prepare<{ embedding: Buffer }, [string]>(
    "SELECT embedding FROM memory_embeddings WHERE id = ?",
  );

  return {
    storage: "sqlite",
    async list(options) {
      const { scopeKey, kind } = options ?? {};
      if (scopeKey && kind) {
        if (!safeScopeKey(scopeKey)) return [];
        return listByScopeAndKindStmt.all(scopeKey, kind).map(rowToRecord);
      }
      if (scopeKey) {
        if (!safeScopeKey(scopeKey)) return [];
        return listByScopeStmt.all(scopeKey).map(rowToRecord);
      }
      if (kind) return listByKindStmt.all(kind).map(rowToRecord);
      return listAllStmt.all().map(rowToRecord);
    },
    async write(record, scope) {
      if (!safeScopeKey(record.scopeKey)) return;
      const scopeType = scope ?? scopeFromKey(record.scopeKey);
      writeStmt.run(
        record.id,
        scopeType,
        record.scopeKey,
        record.kind,
        record.content,
        record.createdAt,
        record.tokenEstimate,
        record.topic ?? null,
      );
    },
    async touchRecalled(ids) {
      if (ids.length === 0) return;
      const now = new Date().toISOString();
      const placeholders = ids.map(() => "?").join(",");
      db.run(`UPDATE memories SET last_recalled_at = ? WHERE id IN (${placeholders})`, [now, ...ids]);
    },
    async remove(id) {
      removeStmt.run(id);
      removeEmbStmt.run(id);
    },
    async retire(ids, disposition) {
      if (ids.length === 0) return [];
      const requested = ids.map(() => "?").join(",");
      const found = db
        .prepare<{ id: string }, string[]>(`SELECT id FROM memories WHERE id IN (${requested})`)
        .all(...ids)
        .map((row) => row.id);
      if (found.length === 0) return [];

      const placeholders = found.map(() => "?").join(",");
      const retiredAt = new Date().toISOString();
      const by = disposition.kind === "superseded" ? JSON.stringify(disposition.by) : null;
      db.transaction(() => {
        db.run(
          `INSERT INTO memory_archive
             (id, scope, scope_key, kind, content, created_at, token_estimate, last_recalled_at, topic,
              retired_at, disposition, superseded_by)
           SELECT id, scope, scope_key, kind, content, created_at, token_estimate, last_recalled_at, topic, ?, ?, ?
             FROM memories WHERE id IN (${placeholders})`,
          [retiredAt, disposition.kind, by, ...found],
        );
        db.run(`DELETE FROM memories WHERE id IN (${placeholders})`, found);
        db.run(`DELETE FROM memory_embeddings WHERE id IN (${placeholders})`, found);
      })();
      return found;
    },
    async listArchive(options) {
      const { scopeKey, kind, disposition } = options ?? {};
      if (scopeKey && !safeScopeKey(scopeKey)) return [];
      const clauses: string[] = [];
      const params: string[] = [];
      if (scopeKey) {
        clauses.push("scope_key = ?");
        params.push(scopeKey);
      }
      if (kind) {
        clauses.push("kind = ?");
        params.push(kind);
      }
      if (disposition) {
        clauses.push("disposition = ?");
        params.push(disposition);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      return db
        .prepare<ArchiveRow, string[]>(`SELECT * FROM memory_archive ${where} ORDER BY retired_at ASC`)
        .all(...params)
        .map(rowToArchiveRecord);
    },
    async restore(ids) {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare<ArchiveRow, string[]>(`SELECT * FROM memory_archive WHERE id IN (${placeholders})`)
        .all(...ids);
      if (rows.length === 0) return [];
      const found = rows.map((row) => row.id);
      const foundPlaceholders = found.map(() => "?").join(",");
      db.transaction(() => {
        db.run(
          `INSERT INTO memories
             (id, scope, scope_key, kind, content, created_at, token_estimate, last_recalled_at, topic)
           SELECT id, scope, scope_key, kind, content, created_at, token_estimate, last_recalled_at, topic
             FROM memory_archive WHERE id IN (${foundPlaceholders})`,
          found,
        );
        db.run(`DELETE FROM memory_archive WHERE id IN (${foundPlaceholders})`, found);
      })();
      return rows.map(rowToRecord);
    },
    async writeEmbedding(id, scope, embedding) {
      if (!safeScopeKey(scope)) return;
      writeEmbStmt.run(id, scope, embedding);
    },
    async removeEmbedding(id) {
      removeEmbStmt.run(id);
    },
    async getEmbedding(id) {
      const row = getEmbStmt.get(id);
      return row ? toBuffer(row.embedding) : null;
    },
    async getEmbeddings(ids) {
      if (ids.length === 0) return new Map();
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare<{ id: string; embedding: Buffer }, string[]>(
          `SELECT id, embedding FROM memory_embeddings WHERE id IN (${placeholders})`,
        )
        .all(...ids);
      return new Map(rows.map((row) => [row.id, toBuffer(row.embedding)]));
    },
    close() {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
    },
  };
}

let storeInstance: MemoryStore | null = null;
let storePromise: Promise<MemoryStore> | null = null;

export function getMemoryStore(): Promise<MemoryStore> {
  if (storeInstance) return Promise.resolve(storeInstance);
  if (storePromise) return storePromise;

  storePromise = resolveStore()
    .then((store) => {
      storeInstance = store;
      storePromise = null;
      process.on("exit", () => storeInstance?.close());
      return store;
    })
    .catch((error) => {
      storePromise = null;
      throw error;
    });
  return storePromise;
}

async function resolveStore(): Promise<MemoryStore> {
  const { appConfig } = await import("./app-config");
  if (appConfig.features.cloudSync && appConfig.cloudUrl && appConfig.cloudToken) {
    const { getCloudClient } = await import("./cloud-client");
    log.debug("memory.store.opened", { storage: "cloud" });
    return (await getCloudClient()).memory;
  }
  log.debug("memory.store.opened", { storage: "sqlite" });
  return createSqliteMemoryStore();
}
