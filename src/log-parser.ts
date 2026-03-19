import { escapeRegex } from "./string-utils";

const FIELD_RE = /(?:^|\s)([a-z_][a-z0-9_]*)=(?:"((?:[^"\\]|\\.)*)"|([^\s]+))/g;

export function parseField(line: string, key: string): string | undefined {
  const escapedKey = escapeRegex(key);
  const quoted = line.match(new RegExp(`(?:^|\\s)${escapedKey}="((?:[^"\\\\]|\\\\.)*)"`));
  if (quoted?.[1] !== undefined) return quoted[1];
  const plain = line.match(new RegExp(`(?:^|\\s)${escapedKey}=([^\\s]+)`));
  return plain?.[1];
}

export function parseTimestamp(line: string): string {
  const firstSpace = line.indexOf(" ");
  return firstSpace > 0 ? line.slice(0, firstSpace) : line;
}

export function parseRequestId(line: string): string | undefined {
  return line.match(/\brequest_id=([^\s]+)/)?.[1];
}

export function parseTaskId(line: string): string | undefined {
  const value = line.match(/\btask_id=([^\s]+)/)?.[1];
  if (!value || value === "null") return undefined;
  return value;
}

export function parseAllFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  fields.timestamp = parseTimestamp(line);
  for (const match of line.matchAll(FIELD_RE)) {
    fields[match[1]] = match[2] ?? match[3];
  }
  return fields;
}

export function matchesTaskId(line: string, taskId: string): boolean {
  return new RegExp(`\\btask_id=${escapeRegex(taskId)}(?:\\s|$)`).test(line);
}

export function matchesRequestId(line: string, requestId: string): boolean {
  return new RegExp(`\\brequest_id=${escapeRegex(requestId)}(?:\\s|$)`).test(line);
}
