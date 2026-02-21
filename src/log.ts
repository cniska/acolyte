import { readResolvedConfigSync } from "./config";

export type LogLevel = "debug" | "info" | "warn" | "error";
type LogFormat = "logfmt" | "json";
const config = readResolvedConfigSync();

type LogFields = Record<string, string | number | boolean | null | undefined>;

function resolveLogFormat(): LogFormat {
  return config.logFormat;
}

function renderLogfmtLine(level: LogLevel, message: string, fields?: LogFields): string {
  const timestamp = new Date().toISOString();
  const pairs = fields
    ? Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
    : [];
  const tail = pairs.length > 0 ? ` ${pairs.join(" ")}` : "";
  return `${timestamp} level=${level} msg="${message.replace(/"/g, '\\"')}"${tail}\n`;
}

function renderJsonLine(level: LogLevel, message: string, fields?: LogFields): string {
  const body = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  };
  return `${JSON.stringify(body)}\n`;
}

export function renderLogLine(level: LogLevel, message: string, fields?: LogFields, format?: LogFormat): string {
  const resolvedFormat = format ?? resolveLogFormat();
  if (resolvedFormat === "json") {
    return renderJsonLine(level, message, fields);
  }
  return renderLogfmtLine(level, message, fields);
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const line = renderLogLine(level, message, fields);
  if (level === "warn" || level === "error") {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

export const log = {
  debug: (message: string, fields?: LogFields): void => write("debug", message, fields),
  info: (message: string, fields?: LogFields): void => write("info", message, fields),
  warn: (message: string, fields?: LogFields): void => write("warn", message, fields),
  error: (message: string, fields?: LogFields): void => write("error", message, fields),
};
