import type postgres from "postgres";
import type { Migration } from "./db-migrate";
import { log } from "./log";
import type { Session, SessionId } from "./session-contract";
import type { SessionStore } from "./session-store";

type SessionRow = {
  id: string;
  created_at: string;
  updated_at: string;
  model: string;
  title: string;
  workspace: string | null;
  workspace_name: string | null;
  workspace_branch: string | null;
  messages: unknown;
  token_usage: unknown;
};

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id as SessionId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    model: row.model,
    title: row.title,
    ...(row.workspace ? { workspace: row.workspace } : {}),
    ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}),
    ...(row.workspace_branch ? { workspaceBranch: row.workspace_branch } : {}),
    messages: Array.isArray(row.messages) ? row.messages : [],
    tokenUsage: Array.isArray(row.token_usage) ? row.token_usage : [],
  };
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        model TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        workspace TEXT,
        workspace_name TEXT,
        workspace_branch TEXT,
        messages JSONB NOT NULL DEFAULT '[]',
        token_usage JSONB NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS session_preferences (
        device_id TEXT PRIMARY KEY,
        active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL
      );
    `,
  },
];

async function migrateUp(sql: postgres.Sql, migrations: Migration[]): Promise<number> {
  await sql`CREATE TABLE IF NOT EXISTS session_schema_version (version INTEGER NOT NULL)`;
  const rows = await sql<{ version: number }[]>`SELECT version FROM session_schema_version LIMIT 1`;
  const current = rows[0]?.version ?? 0;
  if (rows.length === 0) await sql`INSERT INTO session_schema_version (version) VALUES (0)`;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    await sql.begin(async (tx) => {
      await tx.unsafe(m.up);
      await tx`UPDATE session_schema_version SET version = ${m.version}`;
    });
  }
  return pending.length;
}

export async function createPostgresSessionStore(connectionUrl: string): Promise<SessionStore> {
  let createSql: typeof postgres;
  try {
    createSql = (await import("postgres")).default;
  } catch {
    throw new Error("Install 'postgres' to use Postgres session storage");
  }

  const sql = createSql(connectionUrl);
  const applied = await migrateUp(sql, MIGRATIONS);
  if (applied > 0) log.debug("session.postgres.migrated", { applied });

  return {
    async listSessions(options) {
      const limit = options?.limit ?? 100;
      const rows = await sql<SessionRow[]>`
        SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ${limit}`;
      return rows.map(rowToSession);
    },

    async getSession(id) {
      const rows = await sql<SessionRow[]>`SELECT * FROM sessions WHERE id = ${id}`;
      return rows.length > 0 ? rowToSession(rows[0]) : null;
    },

    async saveSession(session) {
      await sql`
        INSERT INTO sessions (id, created_at, updated_at, model, title, workspace, workspace_name, workspace_branch, messages, token_usage)
        VALUES (
          ${session.id}, ${session.createdAt}, ${session.updatedAt}, ${session.model}, ${session.title},
          ${session.workspace ?? null}, ${session.workspaceName ?? null}, ${session.workspaceBranch ?? null},
          ${JSON.stringify(session.messages)}::jsonb, ${JSON.stringify(session.tokenUsage)}::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          updated_at = EXCLUDED.updated_at,
          model = EXCLUDED.model,
          title = EXCLUDED.title,
          workspace = EXCLUDED.workspace,
          workspace_name = EXCLUDED.workspace_name,
          workspace_branch = EXCLUDED.workspace_branch,
          messages = EXCLUDED.messages,
          token_usage = EXCLUDED.token_usage`;
    },

    async removeSession(id) {
      await sql`DELETE FROM session_preferences WHERE active_session_id = ${id}`;
      await sql`DELETE FROM sessions WHERE id = ${id}`;
    },

    async getActiveSessionId() {
      const rows = await sql<{ active_session_id: string | null }[]>`
        SELECT active_session_id FROM session_preferences LIMIT 1`;
      const id = rows[0]?.active_session_id;
      return id ? (id as SessionId) : undefined;
    },

    async setActiveSessionId(id) {
      if (id === undefined) {
        await sql`DELETE FROM session_preferences`;
      } else {
        await sql`
          INSERT INTO session_preferences (device_id, active_session_id)
          VALUES ('default', ${id})
          ON CONFLICT (device_id) DO UPDATE SET active_session_id = EXCLUDED.active_session_id`;
      }
    },

    close() {
      sql.end().catch((error: unknown) => log.warn("session.postgres.close_failed", { error: String(error) }));
    },
  };
}
