import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { log } from "./log";
import type { LogLine, TaskSummary } from "./log-parser";

export type TraceEntry = {
  timestamp: string;
  taskId?: string;
  requestId?: string;
  sessionId?: string;
  event?: string;
  sequence?: number;
  phaseAttempt?: number;
  eventTs?: string;
  fields: Record<string, string | number | boolean | null | undefined>;
};

export interface TraceStore {
  write(entry: TraceEntry): void;
  listTasks(limit: number): TaskSummary[];
  listByTaskId(taskId: string): LogLine[];
  close(): void;
}

function initSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS trace_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      task_id TEXT,
      request_id TEXT,
      session_id TEXT,
      event TEXT,
      sequence INTEGER,
      phase_attempt INTEGER,
      event_ts TEXT,
      fields_json TEXT NOT NULL DEFAULT '{}'
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_trace_task ON trace_events(task_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_trace_ts ON trace_events(timestamp DESC)`);
}

type TraceRow = {
  id: number;
  timestamp: string;
  task_id: string | null;
  request_id: string | null;
  session_id: string | null;
  event: string | null;
  sequence: number | null;
  phase_attempt: number | null;
  event_ts: string | null;
  fields_json: string;
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
  if (row.phase_attempt != null) fields.phase_attempt = String(row.phase_attempt);
  if (row.event_ts) fields.event_ts = row.event_ts;
  return {
    raw: "",
    timestamp: row.timestamp,
    fields,
    taskId: row.task_id ?? undefined,
    requestId: row.request_id ?? undefined,
  };
}

type TaskRow = {
  task_id: string;
  timestamp: string;
  model: string | null;
  has_error: number;
};

function fieldsToJson(fields: Record<string, string | number | boolean | null | undefined>): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) clean[key] = value;
  }
  return JSON.stringify(clean);
}

export function createTraceStore(dbPath?: string): TraceStore {
  const resolvedPath = dbPath ?? join(homedir(), ".acolyte", "trace.db");
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  initSchema(db);
  log.debug("trace.store_opened", { path: resolvedPath });

  const writeStmt = db.prepare<
    void,
    [
      string,
      string | null,
      string | null,
      string | null,
      string | null,
      number | null,
      number | null,
      string | null,
      string,
    ]
  >(
    `INSERT INTO trace_events (timestamp, task_id, request_id, session_id, event, sequence, phase_attempt, event_ts, fields_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const listByTaskStmt = db.prepare<TraceRow, [string]>("SELECT * FROM trace_events WHERE task_id = ? ORDER BY id ASC");

  const listTasksStmt = db.prepare<TaskRow, [number]>(`
    SELECT
      e.task_id,
      MIN(e.timestamp) AS timestamp,
      (SELECT e2.fields_json FROM trace_events e2 WHERE e2.task_id = e.task_id AND e2.event = 'lifecycle.start' LIMIT 1) AS model,
      MAX(CASE WHEN e.event = 'lifecycle.summary' AND json_extract(e.fields_json, '$.has_error') = 'true' THEN 1 ELSE 0 END) AS has_error
    FROM trace_events e
    WHERE e.task_id IS NOT NULL
    GROUP BY e.task_id
    ORDER BY MIN(e.timestamp) DESC
    LIMIT ?
  `);

  return {
    write(entry) {
      writeStmt.run(
        entry.timestamp,
        entry.taskId ?? null,
        entry.requestId ?? null,
        entry.sessionId ?? null,
        entry.event ?? null,
        entry.sequence ?? null,
        entry.phaseAttempt ?? null,
        entry.eventTs ?? null,
        fieldsToJson(entry.fields),
      );
    },
    listTasks(limit) {
      return listTasksStmt.all(limit).map((row) => {
        let model: string | undefined;
        if (row.model) {
          try {
            const parsed = JSON.parse(row.model) as Record<string, unknown>;
            model = parsed.model != null ? String(parsed.model) : undefined;
          } catch {
            // Ignore malformed JSON.
          }
        }
        return {
          taskId: row.task_id,
          timestamp: row.timestamp,
          model,
          event: undefined,
          hasError: row.has_error === 1,
        };
      });
    },
    listByTaskId(taskId) {
      return listByTaskStmt.all(taskId).map(rowToLogLine);
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
  return join(homedir(), ".acolyte", "trace.db");
}

export function openReadOnlyTraceStore(dbPath?: string): TraceStore | null {
  const resolvedPath = dbPath ?? defaultTraceDbPath();
  if (!existsSync(resolvedPath)) return null;
  try {
    return createTraceStore(resolvedPath);
  } catch {
    return null;
  }
}
