import type postgres from "postgres";
import { log } from "./log";
import { type MemoryRecord, type MemoryStore, safeScopeKey, scopeFromKey } from "./memory-contract";
import { bufferToEmbedding, embeddingToBuffer } from "./memory-embedding";

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

function vectorToBuffer(vector: string): Buffer {
  const nums = vector
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);
  return embeddingToBuffer(new Float32Array(nums));
}

function bufferToVector(buf: Buffer): string {
  const arr = bufferToEmbedding(buf);
  return `[${Array.from(arr).join(",")}]`;
}

const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE EXTENSION IF NOT EXISTS vector;
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
        embedding vector(1536) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_embeddings_scope ON memory_embeddings(scope);
    `,
  },
];

async function migrateUp(sql: postgres.Sql): Promise<number> {
  await sql`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`;
  const rows = await sql<{ version: number }[]>`SELECT version FROM schema_version LIMIT 1`;
  const current = rows[0]?.version ?? 0;
  if (rows.length === 0) await sql`INSERT INTO schema_version (version) VALUES (0)`;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    await sql.begin(async (tx) => {
      await tx.unsafe(m.up);
      await tx`UPDATE schema_version SET version = ${m.version}`;
    });
  }
  return pending.length;
}

export async function createPostgresMemoryStore(connectionUrl: string): Promise<MemoryStore> {
  let createSql: typeof postgres;
  let registerPgvector: (sql: postgres.Sql) => Promise<void>;
  try {
    createSql = (await import("postgres")).default;
    // @ts-expect-error -- pgvector has no type declarations
    const pgvectorMod = await import("pgvector/postgres");
    registerPgvector = (sql: postgres.Sql) => pgvectorMod.default.registerTypes(sql);
  } catch {
    throw new Error("Install 'postgres' and 'pgvector' to use Postgres memory storage");
  }

  const sql = createSql(connectionUrl);
  await registerPgvector(sql);
  const applied = await migrateUp(sql);
  if (applied > 0) log.debug("memory.postgres.migrated", { applied });

  return {
    async list(options) {
      const { scopeKey, kind } = options ?? {};
      if (scopeKey && !safeScopeKey(scopeKey)) return [];

      let rows: MemoryRow[];
      if (scopeKey && kind) {
        rows = await sql<MemoryRow[]>`
          SELECT * FROM memories WHERE scope_key = ${scopeKey} AND kind = ${kind} ORDER BY created_at ASC`;
      } else if (scopeKey) {
        rows = await sql<MemoryRow[]>`
          SELECT * FROM memories WHERE scope_key = ${scopeKey} ORDER BY created_at ASC`;
      } else if (kind) {
        rows = await sql<MemoryRow[]>`
          SELECT * FROM memories WHERE kind = ${kind} ORDER BY created_at ASC`;
      } else {
        rows = await sql<MemoryRow[]>`SELECT * FROM memories ORDER BY created_at ASC`;
      }
      return rows.map(rowToRecord);
    },

    async write(record, scope) {
      if (!safeScopeKey(record.scopeKey)) return;
      const scopeType = scope ?? scopeFromKey(record.scopeKey);
      await sql`
        INSERT INTO memories (id, scope, scope_key, kind, content, created_at, token_estimate)
        VALUES (${record.id}, ${scopeType}, ${record.scopeKey}, ${record.kind}, ${record.content}, ${record.createdAt}, ${record.tokenEstimate})
        ON CONFLICT (id) DO UPDATE SET
          scope = EXCLUDED.scope,
          scope_key = EXCLUDED.scope_key,
          kind = EXCLUDED.kind,
          content = EXCLUDED.content,
          created_at = EXCLUDED.created_at,
          token_estimate = EXCLUDED.token_estimate`;
    },

    async remove(id) {
      await sql`DELETE FROM memory_embeddings WHERE id = ${id}`;
      await sql`DELETE FROM memories WHERE id = ${id}`;
    },

    async touchRecalled(ids) {
      if (ids.length === 0) return;
      const now = new Date().toISOString();
      await sql`UPDATE memories SET last_recalled_at = ${now} WHERE id = ANY(${ids})`;
    },

    async writeEmbedding(id, scope, embedding) {
      if (!safeScopeKey(scope)) return;
      const vector = bufferToVector(embedding);
      await sql`
        INSERT INTO memory_embeddings (id, scope, embedding)
        VALUES (${id}, ${scope}, ${vector}::vector)
        ON CONFLICT (id) DO UPDATE SET scope = EXCLUDED.scope, embedding = EXCLUDED.embedding`;
    },

    async removeEmbedding(id) {
      await sql`DELETE FROM memory_embeddings WHERE id = ${id}`;
    },

    async getEmbedding(id) {
      const rows = await sql<{ embedding: string }[]>`
        SELECT embedding::text FROM memory_embeddings WHERE id = ${id}`;
      if (rows.length === 0) return null;
      return vectorToBuffer(rows[0].embedding);
    },

    async getEmbeddings(ids) {
      if (ids.length === 0) return new Map();
      const rows = await sql<{ id: string; embedding: string }[]>`
        SELECT id, embedding::text FROM memory_embeddings WHERE id = ANY(${ids})`;
      return new Map(rows.map((row) => [row.id, vectorToBuffer(row.embedding)]));
    },

    async searchByEmbedding(queryEmbedding, options) {
      const vector = `[${Array.from(queryEmbedding).join(",")}]`;
      const { scopeKey, kind, limit } = options;
      if (scopeKey && !safeScopeKey(scopeKey)) return [];

      let rows: MemoryRow[];
      if (scopeKey && kind) {
        rows = await sql<MemoryRow[]>`
          SELECT m.* FROM memories m
          JOIN memory_embeddings e ON m.id = e.id
          WHERE m.scope_key = ${scopeKey} AND m.kind = ${kind}
          ORDER BY e.embedding <=> ${vector}::vector
          LIMIT ${limit}`;
      } else if (scopeKey) {
        rows = await sql<MemoryRow[]>`
          SELECT m.* FROM memories m
          JOIN memory_embeddings e ON m.id = e.id
          WHERE m.scope_key = ${scopeKey}
          ORDER BY e.embedding <=> ${vector}::vector
          LIMIT ${limit}`;
      } else if (kind) {
        rows = await sql<MemoryRow[]>`
          SELECT m.* FROM memories m
          JOIN memory_embeddings e ON m.id = e.id
          WHERE m.kind = ${kind}
          ORDER BY e.embedding <=> ${vector}::vector
          LIMIT ${limit}`;
      } else {
        rows = await sql<MemoryRow[]>`
          SELECT m.* FROM memories m
          JOIN memory_embeddings e ON m.id = e.id
          ORDER BY e.embedding <=> ${vector}::vector
          LIMIT ${limit}`;
      }
      return rows.map(rowToRecord);
    },

    close() {
      sql.end().catch((error: unknown) => log.warn("memory.postgres.close_failed", { error: String(error) }));
    },
  };
}
