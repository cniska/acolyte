import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Migration, migrateUp } from "./db-migrate";
import { resolveHomeDir } from "./home-dir";
import type { LogLine, TaskSummary } from "./log-parser";

const PROMOTED_COLUMNS = new Set(["event", "task_id", "request_id", "session_id", "sequence"]);

export type TraceEntry = {
  timestamp: string;
  taskId?: string;
  requestId?: string;
  sessionId?: string;
  event?: string;
  sequence?: number;
  fields: Record<string, string | number | boolean | null | undefined>;
};

export interface TraceStore {
  write(entry: TraceEntry): void;
  listTasks(limit: number): TaskSummary[];
  listByTaskId(taskId: string): LogLine[];
  close(): void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS trace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        task_id TEXT,
        request_id TEXT,
        session_id TEXT,
        event TEXT,
        sequence INTEGER,
        fields_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_trace_task ON trace_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_trace_ts ON trace_events(timestamp DESC);
    `,
  },
];

type TraceRow = {
  timestamp: string;
  task_id: string | null;
  request_id: string | null;
  session_id: string | null;
  event: string | null;
  sequence: number | null;
  fields_json: string;
};

type TaskRow = {
  task_id: string;
  timestamp: string;
  model: string | null;
  has_error: number;
  lifecycle_signal: string | null;
};

function rowToLogLine(row: TraceRow): LogLine {
  let fields: Record<string, string>;
  try {
    const parsed = JSON.parse(row.fields_json) as Record<string, unknown>;
    fields = {};
    for (const [key, value] of Object.entries(parsed)) {
      fields[key] = value == null ? "" : String(value);
    }
  } catch {
    fields = {};
  }
  if (row.event) fields.event = row.event;
  if (row.task_id) fields.task_id = row.task_id;
  if (row.request_id) fields.request_id = row.request_id;
  if (row.session_id) fields.session_id = row.session_id;
  if (row.sequence != null) fields.sequence = String(row.sequence);
  return {
    raw: "",
    timestamp: row.timestamp,
    fields,
    taskId: row.task_id ?? undefined,
    requestId: row.request_id ?? undefined,
  };
}

function taskRowToSummary(row: TaskRow): TaskSummary {
  return {
    taskId: row.task_id,
    timestamp: row.timestamp,
    model: row.model ?? undefined,
    event: undefined,
    hasError: row.has_error === 1,
    lifecycleSignal: row.lifecycle_signal ?? undefined,
  };
}

function fieldsToJson(fields: Record<string, string | number | boolean | null | undefined>): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && !PROMOTED_COLUMNS.has(key)) clean[key] = value;
  }
  return JSON.stringify(clean);
}

const SELECT_COLUMNS = "timestamp, task_id, request_id, session_id, event, sequence, fields_json";

const LIST_BY_TASK_SQL = `SELECT ${SELECT_COLUMNS} FROM trace_events WHERE task_id = ? ORDER BY id ASC`;

const LIST_TASKS_SQL = `
  SELECT
    e.task_id,
    MIN(e.timestamp) AS timestamp,
    (SELECT json_extract(e2.fields_json, '$.model') FROM trace_events e2 WHERE e2.task_id = e.task_id AND e2.event = 'lifecycle.start' LIMIT 1) AS model,
    MAX(CASE WHEN e.event = 'lifecycle.summary' AND json_extract(e.fields_json, '$.has_error') = 'true' THEN 1 ELSE 0 END) AS has_error,
    (SELECT json_extract(e3.fields_json, '$.lifecycle_signal') FROM trace_events e3 WHERE e3.task_id = e.task_id AND e3.event = 'lifecycle.summary' LIMIT 1) AS lifecycle_signal
  FROM trace_events e
  WHERE e.task_id IS NOT NULL
  GROUP BY e.task_id
  ORDER BY MIN(e.timestamp) DESC
  LIMIT ?
`;

function prepareReadQueries(db: Database) {
  return {
    listByTask: db.prepare<TraceRow, [string]>(LIST_BY_TASK_SQL),
    listTasks: db.prepare<TaskRow, [number]>(LIST_TASKS_SQL),
  };
}

export function createTraceStore(dbPath?: string): TraceStore {
  const resolvedPath = dbPath ?? defaultTraceDbPath();
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  migrateUp(db, MIGRATIONS);

  const writeStmt = db.prepare<
    void,
    [string, string | null, string | null, string | null, string | null, number | null, string]
  >(
    `INSERT INTO trace_events (timestamp, task_id, request_id, session_id, event, sequence, fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const queries = prepareReadQueries(db);

  return {
    write(entry) {
      writeStmt.run(
        entry.timestamp,
        entry.taskId ?? null,
        entry.requestId ?? null,
        entry.sessionId ?? null,
        entry.event ?? null,
        entry.sequence ?? null,
        fieldsToJson(entry.fields),
      );
    },
    listTasks(limit) {
      return queries.listTasks.all(limit).map(taskRowToSummary);
    },
    listByTaskId(taskId) {
      return queries.listByTask.all(taskId).map(rowToLogLine);
    },
    close() {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
    },
  };
}

function openReadOnly(dbPath: string): TraceStore {
  const db = new Database(dbPath, { readonly: true });
  const queries = prepareReadQueries(db);
  return {
    write() {
      // Read-only store — writes are silently dropped.
    },
    listTasks(limit) {
      return queries.listTasks.all(limit).map(taskRowToSummary);
    },
    listByTaskId(taskId) {
      return queries.listByTask.all(taskId).map(rowToLogLine);
    },
    close() {
      db.close();
    },
  };
}

let defaultStore: TraceStore | null = null;

export function getDefaultTraceStore(): TraceStore {
  if (!defaultStore) {
    defaultStore = createTraceStore();
  }
  return defaultStore;
}

export function closeDefaultTraceStore(): void {
  if (defaultStore) {
    defaultStore.close();
    defaultStore = null;
  }
}

export function defaultTraceDbPath(): string {
  return join(resolveHomeDir(), ".acolyte", "trace.db");
}

export function openTraceStore(dbPath?: string): TraceStore | null {
  const resolvedPath = dbPath ?? defaultTraceDbPath();
  try {
    return openReadOnly(resolvedPath);
  } catch {
    return null;
  }
}
