import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Migration, migrateUp } from "./db-migrate";
import { resolveHomeDir } from "./home-dir";
import { log } from "./log";

export interface ToolCacheStore {
  get(key: string): string | null;
  set(key: string, value: string, paths: string[]): void;
  invalidateByPath(paths: string[]): number;
  clear(): void;
  close(): void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS tool_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tool_cache_paths (
        key TEXT NOT NULL,
        path TEXT NOT NULL,
        PRIMARY KEY (key, path)
      );
      CREATE INDEX IF NOT EXISTS idx_cache_path ON tool_cache_paths(path);
    `,
  },
];

export function createToolCacheStore(dbPath?: string): ToolCacheStore {
  const resolvedPath = dbPath ?? join(resolveHomeDir(), ".acolyte", "tool.db");
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  migrateUp(db, MIGRATIONS);
  log.debug("tool.cache.store_opened", { path: resolvedPath });

  const getStmt = db.prepare<{ value: string }, [string]>("SELECT value FROM tool_cache WHERE key = ?");
  const setStmt = db.prepare<void, [string, string]>("INSERT OR REPLACE INTO tool_cache (key, value) VALUES (?, ?)");
  const setPathStmt = db.prepare<void, [string, string]>(
    "INSERT OR IGNORE INTO tool_cache_paths (key, path) VALUES (?, ?)",
  );
  const deleteStmt = db.prepare<void, [string]>("DELETE FROM tool_cache WHERE key = ?");
  const deletePathsStmt = db.prepare<void, [string]>("DELETE FROM tool_cache_paths WHERE key = ?");

  return {
    get(key) {
      const row = getStmt.get(key);
      return row ? row.value : null;
    },
    set(key, value, paths) {
      setStmt.run(key, value);
      deletePathsStmt.run(key);
      for (const path of paths) {
        setPathStmt.run(key, path);
      }
    },
    invalidateByPath(paths) {
      if (paths.length === 0) return 0;
      const placeholders = paths.map(() => "?").join(",");
      const keys = db
        .prepare<{ key: string }, string[]>(`SELECT DISTINCT key FROM tool_cache_paths WHERE path IN (${placeholders})`)
        .all(...paths);
      for (const { key } of keys) {
        deleteStmt.run(key);
        deletePathsStmt.run(key);
      }
      return keys.length;
    },
    clear() {
      db.run("DELETE FROM tool_cache");
      db.run("DELETE FROM tool_cache_paths");
    },
    close() {
      db.close();
    },
  };
}

let defaultStore: ToolCacheStore | null = null;
let lastSessionId: string | null = null;

export function getDefaultToolCacheStore(sessionId?: string): ToolCacheStore {
  if (!defaultStore) {
    defaultStore = createToolCacheStore();
    process.on("exit", () => defaultStore?.close());
  }
  if (sessionId && lastSessionId && sessionId !== lastSessionId) {
    defaultStore.clear();
    log.debug("tool.cache.session_switch", { from: lastSessionId, to: sessionId });
  }
  if (sessionId) lastSessionId = sessionId;
  return defaultStore;
}
