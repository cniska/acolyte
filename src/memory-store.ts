import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { log } from "./log";
import { type MemoryRecord, type MemoryScope, type MemoryStore, memoryRecordSchema } from "./memory-contract";

export function safeScopeKey(scope: string): string | null {
  return /^(sess|user|proj)_[a-z0-9_-]+$/.test(scope) ? scope : null;
}

function scopeTypeFromKey(scopeKey: string): MemoryScope {
  if (scopeKey.startsWith("sess_")) return "session";
  if (scopeKey.startsWith("proj_")) return "project";
  if (scopeKey.startsWith("user_")) return "user";
  throw new Error(`Unknown scope key prefix: ${scopeKey}`);
}

// TODO(cniska): Drop migrateLegacySchema at v1.0.0.
function migrateLegacySchema(db: Database): void {
  const hasLegacyTable = db
    .prepare<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='distill_records'")
    .get();
  if (hasLegacyTable) {
    db.run("ALTER TABLE distill_records RENAME TO memories");
    db.run("ALTER TABLE memories RENAME COLUMN tier TO kind");
    db.run("ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT ''");
    db.run(`
      UPDATE memories SET scope = CASE
        WHEN scope_key LIKE 'sess_%' THEN 'session'
        WHEN scope_key LIKE 'proj_%' THEN 'project'
        WHEN scope_key LIKE 'user_%' THEN 'user'
        ELSE ''
      END
    `);
  }
  const hasLegacyEmb = db
    .prepare<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='distill_embeddings'")
    .get();
  if (hasLegacyEmb) {
    db.run("ALTER TABLE distill_embeddings RENAME TO memory_embeddings");
    db.run("ALTER TABLE memory_embeddings RENAME COLUMN record_id TO id");
    db.run("ALTER TABLE memory_embeddings RENAME COLUMN scope_key TO scope");
  }
}

function initSchema(db: Database): void {
  migrateLegacySchema(db);
  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      current_task TEXT,
      next_step TEXT,
      created_at TEXT NOT NULL,
      token_estimate INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_scope_key ON memories(scope_key)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      embedding BLOB NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_embeddings_scope ON memory_embeddings(scope)`);
}

type MemoryRow = {
  id: string;
  scope: string;
  scope_key: string;
  kind: string;
  content: string;
  current_task: string | null;
  next_step: string | null;
  created_at: string;
  token_estimate: number;
};

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    scopeKey: row.scope_key,
    kind: row.kind as MemoryRecord["kind"],
    content: row.content,
    ...(row.current_task ? { currentTask: row.current_task } : {}),
    ...(row.next_step ? { nextStep: row.next_step } : {}),
    createdAt: row.created_at,
    tokenEstimate: row.token_estimate,
  };
}

export function createSqliteMemoryStore(dbPath?: string): MemoryStore {
  const resolvedPath = dbPath ?? join(homedir(), ".acolyte", "memory.db");
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  initSchema(db);

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
  const writeStmt = db.prepare<
    void,
    [string, string, string, string, string, string | null, string | null, string, number]
  >(
    `INSERT OR REPLACE INTO memories (id, scope, scope_key, kind, content, current_task, next_step, created_at, token_estimate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      const scopeType = scope ?? scopeTypeFromKey(record.scopeKey);
      writeStmt.run(
        record.id,
        scopeType,
        record.scopeKey,
        record.kind,
        record.content,
        record.currentTask ?? null,
        record.nextStep ?? null,
        record.createdAt,
        record.tokenEstimate,
      );
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
      db.close();
    },
  };
}

let defaultInstance: MemoryStore | null = null;

export function getDefaultMemoryStore(): MemoryStore {
  if (!defaultInstance) {
    defaultInstance = createSqliteMemoryStore();
    log.debug("memory.store.opened");
    const home = homedir();
    migrateFromFilesystem(home, defaultInstance).catch((error) => {
      log.warn("memory.distill.migration_failed", { error: String(error) });
    });
    migrateFromMarkdown(home, process.cwd(), defaultInstance).catch((error) => {
      log.warn("memory.markdown.migration_failed", { error: String(error) });
    });
    process.on("exit", () => defaultInstance?.close());
  }
  return defaultInstance;
}

// TODO(cniska): Drop legacy distill filesystem migration at v1.0.0.
export async function migrateFromFilesystem(homeDir: string, store: MemoryStore): Promise<number> {
  const distillDir = join(homeDir, ".acolyte", "distill");
  if (!existsSync(distillDir)) return 0;

  let migrated = 0;
  const scopeDirs = await readdir(distillDir, { withFileTypes: true });
  const records: MemoryRecord[] = [];
  for (const entry of scopeDirs) {
    if (!entry.isDirectory()) continue;
    const scope = entry.name;
    if (!safeScopeKey(scope)) continue;
    const scopePath = join(distillDir, scope);
    const files = await readdir(scopePath);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(scopePath, file), "utf8");
        const json = JSON.parse(raw);
        if (json.tier && !json.kind) json.kind = json.tier;
        if (json.sessionId && !json.scopeKey) json.scopeKey = json.sessionId;
        const parsed = memoryRecordSchema.safeParse(json);
        if (parsed.success) records.push(parsed.data);
      } catch {
        // Skip unreadable files.
      }
    }
  }

  for (const record of records) {
    await store.write(record, scopeTypeFromKey(record.scopeKey));
    migrated += 1;
  }

  const backupPath = join(homeDir, ".acolyte", "distill.bak");
  if (!existsSync(backupPath)) {
    await rename(distillDir, backupPath);
  }

  log.info("memory.distill.migration_done", { migrated });
  return migrated;
}

// TODO(cniska): Drop legacy markdown memory migration at v1.0.0.
export async function migrateFromMarkdown(homeDir: string, cwd: string, store: MemoryStore): Promise<number> {
  const dirs: { path: string; scope: "user" | "project"; scopeKey: string }[] = [
    {
      path: join(homeDir, ".acolyte", "memory", "user"),
      scope: "user",
      scopeKey: `user_${new Bun.CryptoHasher("sha1").update(resolve(homeDir)).digest("hex").slice(0, 12)}`,
    },
    {
      path: join(cwd, ".acolyte", "memory", "project"),
      scope: "project",
      scopeKey: `proj_${new Bun.CryptoHasher("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}`,
    },
  ];

  let migrated = 0;
  for (const { path: dir, scope, scopeKey } of dirs) {
    if (!existsSync(dir)) continue;
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf8");
        const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!match) continue;
        const meta: Record<string, string> = {};
        for (const line of match[1].split("\n")) {
          const idx = line.indexOf(":");
          if (idx <= 0) continue;
          meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
        const id = meta.id?.trim();
        const createdAt = meta.createdAt?.trim();
        const content = match[2].trim();
        if (!id || !createdAt || !content) continue;

        await store.write(
          {
            id,
            scopeKey,
            kind: "stored",
            content,
            createdAt,
            tokenEstimate: Math.ceil(content.length / 4),
          },
          scope,
        );
        migrated += 1;
      } catch {
        // Skip unreadable files.
      }
    }
    const backupPath = `${dir}.bak`;
    if (!existsSync(backupPath)) {
      await rename(dir, backupPath);
    }
  }

  if (migrated > 0) log.info("memory.markdown.migration_done", { migrated });
  return migrated;
}
