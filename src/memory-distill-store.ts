import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { log } from "./log";
import { type DistillRecord, distillRecordSchema } from "./memory-contract";

export interface DistillStore {
  list(scopeKey: string): Promise<readonly DistillRecord[]>;
  write(record: DistillRecord): Promise<void>;
  remove(id: string, scopeKey: string): Promise<void>;
  writeEmbedding(recordId: string, scopeKey: string, embedding: Buffer): void;
  removeEmbedding(recordId: string): void;
  getEmbedding(recordId: string): Buffer | null;
  getEmbeddings(recordIds: string[]): Map<string, Buffer>;
  close(): void;
}

export function safeDistillScopeKey(scopeKey: string): string | null {
  return /^(sess|user|proj)_[a-z0-9_-]+$/.test(scopeKey) ? scopeKey : null;
}

function initSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS distill_records (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      tier TEXT NOT NULL,
      content TEXT NOT NULL,
      current_task TEXT,
      next_step TEXT,
      created_at TEXT NOT NULL,
      token_estimate INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_distill_scope ON distill_records(scope_key)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS distill_embeddings (
      record_id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      embedding BLOB NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_embedding_scope ON distill_embeddings(scope_key)`);
}

type DistillRow = {
  id: string;
  scope_key: string;
  tier: string;
  content: string;
  current_task: string | null;
  next_step: string | null;
  created_at: string;
  token_estimate: number;
};

function rowToRecord(row: DistillRow): DistillRecord {
  return {
    id: row.id,
    sessionId: row.scope_key,
    tier: row.tier as DistillRecord["tier"],
    content: row.content,
    ...(row.current_task ? { currentTask: row.current_task } : {}),
    ...(row.next_step ? { nextStep: row.next_step } : {}),
    createdAt: row.created_at,
    tokenEstimate: row.token_estimate,
  };
}

export function createSqliteDistillStore(dbPath?: string): DistillStore {
  const resolvedPath = dbPath ?? join(homedir(), ".acolyte", "memory.db");
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  initSchema(db);
  log.debug("memory.distill.store_opened", { path: resolvedPath });

  const listStmt = db.prepare<DistillRow, [string]>(
    "SELECT * FROM distill_records WHERE scope_key = ? ORDER BY created_at ASC",
  );
  const writeStmt = db.prepare<void, [string, string, string, string, string | null, string | null, string, number]>(
    `INSERT OR REPLACE INTO distill_records (id, scope_key, tier, content, current_task, next_step, created_at, token_estimate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const removeStmt = db.prepare<void, [string, string]>("DELETE FROM distill_records WHERE id = ? AND scope_key = ?");
  const writeEmbStmt = db.prepare<void, [string, string, Buffer]>(
    "INSERT OR REPLACE INTO distill_embeddings (record_id, scope_key, embedding) VALUES (?, ?, ?)",
  );
  const removeEmbStmt = db.prepare<void, [string]>("DELETE FROM distill_embeddings WHERE record_id = ?");
  const getEmbStmt = db.prepare<{ embedding: Buffer }, [string]>(
    "SELECT embedding FROM distill_embeddings WHERE record_id = ?",
  );

  return {
    async list(scopeKey) {
      if (!safeDistillScopeKey(scopeKey)) return [];
      return listStmt.all(scopeKey).map(rowToRecord);
    },
    async write(record) {
      if (!safeDistillScopeKey(record.sessionId)) return;
      writeStmt.run(
        record.id,
        record.sessionId,
        record.tier,
        record.content,
        record.currentTask ?? null,
        record.nextStep ?? null,
        record.createdAt,
        record.tokenEstimate,
      );
    },
    async remove(id, scopeKey) {
      if (!safeDistillScopeKey(scopeKey)) return;
      removeStmt.run(id, scopeKey);
      removeEmbStmt.run(id);
    },
    writeEmbedding(recordId, scopeKey, embedding) {
      if (!safeDistillScopeKey(scopeKey)) return;
      writeEmbStmt.run(recordId, scopeKey, embedding);
    },
    removeEmbedding(recordId) {
      removeEmbStmt.run(recordId);
    },
    getEmbedding(recordId) {
      const row = getEmbStmt.get(recordId);
      return row ? row.embedding : null;
    },
    getEmbeddings(recordIds) {
      if (recordIds.length === 0) return new Map();
      const placeholders = recordIds.map(() => "?").join(",");
      const rows = db
        .prepare<{ record_id: string; embedding: Buffer }, string[]>(
          `SELECT record_id, embedding FROM distill_embeddings WHERE record_id IN (${placeholders})`,
        )
        .all(...recordIds);
      return new Map(rows.map((row) => [row.record_id, row.embedding]));
    },
    close() {
      db.close();
    },
  };
}

// TODO(cniska): Drop legacy distill migration at v1.0.0.
export async function migrateFromFilesystem(homeDir: string, store: DistillStore): Promise<number> {
  const distillDir = join(homeDir, ".acolyte", "distill");
  if (!existsSync(distillDir)) return 0;

  let migrated = 0;
  const scopeDirs = await readdir(distillDir, { withFileTypes: true });
  const records: DistillRecord[] = [];
  for (const entry of scopeDirs) {
    if (!entry.isDirectory()) continue;
    const scopeKey = entry.name;
    if (!safeDistillScopeKey(scopeKey)) continue;
    const scopePath = join(distillDir, scopeKey);
    const files = await readdir(scopePath);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(scopePath, file), "utf8");
        const parsed = distillRecordSchema.safeParse(JSON.parse(raw));
        if (parsed.success) records.push(parsed.data);
      } catch {
        // Skip unreadable files.
      }
    }
  }

  for (const record of records) {
    await store.write(record);
    migrated += 1;
  }

  const backupPath = join(homeDir, ".acolyte", "distill.bak");
  if (!existsSync(backupPath)) {
    await rename(distillDir, backupPath);
  }

  log.info("memory.distill.migration_done", { migrated });
  return migrated;
}
