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

export function matchesRequestId(line: LogLine, requestId: string): boolean {
  return line.requestId === requestId;
}

export function field(line: LogLine, key: string): string | undefined {
  return line.fields[key];
}

export type TaskSummary = {
  taskId: string;
  timestamp: string;
  model: string | undefined;
  event: string | undefined;
  hasError: boolean;
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
    const event = line.fields.event;
    if (event === "lifecycle.summary") {
      const entry = seen.get(line.taskId);
      if (entry) entry.hasError = line.fields.has_error === "true";
    }
  }
  return Array.from(seen.values()).reverse();
}

export function findLastTaskId(lines: LogLine[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].taskId) return lines[i].taskId;
  }
  return undefined;
}

export function findLastErrRequestId(lines: LogLine[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const id = lines[i].requestId;
    if (id?.startsWith("err_")) return id;
  }
  return undefined;
}
