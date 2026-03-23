export type LogLine = {
  raw: string;
  timestamp: string;
  fields: Record<string, string>;
  taskId: string | undefined;
  requestId: string | undefined;
};

const FIELD_RE = /(?:^|\s)([a-z_][a-z0-9_]*)=(?:"((?:[^"\\]|\\.)*)"|([^\s]+))/g;

function parseTimestamp(line: string): string {
  const firstSpace = line.indexOf(" ");
  return firstSpace > 0 ? line.slice(0, firstSpace) : line;
}

function parseLine(raw: string): LogLine {
  const fields: Record<string, string> = {};
  for (const match of raw.matchAll(FIELD_RE)) {
    fields[match[1]] = match[2] ?? match[3];
  }
  const taskIdValue = fields.task_id;
  return {
    raw,
    timestamp: parseTimestamp(raw),
    fields,
    taskId: taskIdValue && taskIdValue !== "null" ? taskIdValue : undefined,
    requestId: fields.request_id,
  };
}

export function parseLog(raw: string): LogLine[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseLine);
}

export function matchesTaskId(line: LogLine, taskId: string): boolean {
  return line.taskId === taskId;
}

export type TaskSummary = {
  taskId: string;
  timestamp: string;
  model: string | undefined;
  event: string | undefined;
  hasError: boolean;
  lifecycleSignal?: string;
};

export function listTasks(lines: LogLine[]): TaskSummary[] {
  const seen = new Map<string, TaskSummary>();
  for (const line of lines) {
    if (!line.taskId) continue;
    const existing = seen.get(line.taskId);
    if (!existing) {
      seen.set(line.taskId, {
        taskId: line.taskId,
        timestamp: line.timestamp,
        model: line.fields.model,
        event: line.fields.event,
        hasError: false,
      });
    }
    const entry = seen.get(line.taskId);
    if (entry) {
      if (!entry.model && line.fields.model) entry.model = line.fields.model;
      if (line.fields.event === "lifecycle.summary") {
        entry.hasError = line.fields.has_error === "true";
        if (line.fields.lifecycle_signal) entry.lifecycleSignal = line.fields.lifecycle_signal;
      }
    }
  }
  return Array.from(seen.values()).reverse();
}
