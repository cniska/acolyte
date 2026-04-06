import type { Database } from "bun:sqlite";

export type Migration = {
  version: number;
  up: string;
};

function ensureVersionTable(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare<{ version: number }, []>("SELECT version FROM schema_version LIMIT 1").get();
  if (!row) db.run("INSERT INTO schema_version (version) VALUES (0)");
}

export function migrateUp(db: Database, migrations: Migration[]): number {
  ensureVersionTable(db);
  const row = db.prepare<{ version: number }, []>("SELECT version FROM schema_version LIMIT 1").get();
  const current = row?.version ?? 0;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    db.run("BEGIN");
    try {
      db.run(m.up);
      db.run("UPDATE schema_version SET version = ?", [m.version]);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }
  return pending.length;
}
