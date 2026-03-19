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
