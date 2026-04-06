import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Migration, migrateUp } from "./db-migrate";
import { log } from "./log";
import { type MemoryRecord, type MemoryStore, scopeFromKey } from "./memory-contract";

export function safeScopeKey(scope: string): string | null {
  return /^(sess|user|proj)_[a-z0-9_-]+$/.test(scope) ? scope : null;
}

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
};

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    scopeKey: row.scope_key,
    kind: row.kind as MemoryRecord["kind"],
    content: row.content,
    createdAt: row.created_at,
    tokenEstimate: row.token_estimate,
    lastRecalledAt: row.last_recalled_at ?? null,
  };
}

export function createSqliteMemoryStore(dbPath?: string): MemoryStore {
  const resolvedPath = dbPath ?? join(homedir(), ".acolyte", "memory.db");
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
  const writeStmt = db.prepare<void, [string, string, string, string, string, string, number]>(
    `INSERT OR REPLACE INTO memories (id, scope, scope_key, kind, content, created_at, token_estimate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
      );
    },
    touchRecalled(ids) {
      if (ids.length === 0) return;
      const now = new Date().toISOString();
      const placeholders = ids.map(() => "?").join(",");
      db.run(`UPDATE memories SET last_recalled_at = ? WHERE id IN (${placeholders})`, [now, ...ids]);
    },
    async remove(id) {
      removeStmt.run(id);
      removeEmbStmt.run(id);
    },
    writeEmbedding(id, scope, embedding) {
      if (!safeScopeKey(scope)) return;
      writeEmbStmt.run(id, scope, embedding);
    },
    removeEmbedding(id) {
      removeEmbStmt.run(id);
    },
    getEmbedding(id) {
      const row = getEmbStmt.get(id);
      return row ? row.embedding : null;
    },
    getEmbeddings(ids) {
      if (ids.length === 0) return new Map();
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare<{ id: string; embedding: Buffer }, string[]>(
          `SELECT id, embedding FROM memory_embeddings WHERE id IN (${placeholders})`,
        )
        .all(...ids);
      return new Map(rows.map((row) => [row.id, row.embedding]));
    },
    close() {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
    },
  };
}

let defaultInstance: MemoryStore | null = null;

export function getDefaultMemoryStore(): MemoryStore {
  if (!defaultInstance) {
    defaultInstance = createSqliteMemoryStore();
    log.debug("memory.store.opened");
    process.on("exit", () => defaultInstance?.close());
  }
  return defaultInstance;
}
