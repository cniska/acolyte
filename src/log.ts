import { z } from "zod";
import { readResolvedConfigSync } from "./config";

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof logLevelSchema>;
type LogFormat = "logfmt" | "json";
const config = readResolvedConfigSync();
const REDACTED = "[REDACTED]";

type LogFields = Record<string, string | number | boolean | null | undefined>;

function isSensitiveFieldKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "authorization" ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("cookie") ||
    normalized === "token" ||
    normalized.endsWith("_token") ||
    normalized.endsWith("-token")
  );
}

function redactString(value: string): string {
  return value
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|password|secret)\s*[=:]\s*)[^\s,;&]+/gi,
      "$1[REDACTED]",
    )
    .replace(/([?&](?:api[_-]?key|access_token|refresh_token|session_token|password|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/g, REDACTED);
}

function sanitizeLogFields(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (isSensitiveFieldKey(key)) {
      sanitized[key] = REDACTED;
      continue;
    }
    sanitized[key] = typeof value === "string" ? redactString(value) : value;
  }
  return sanitized;
}

function encodeLogfmtValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const compact = value.replace(/\s+/g, " ").trim();
  if (/^[a-zA-Z0-9._:/-]+$/.test(compact)) return compact;
  return JSON.stringify(compact);
}

function resolveLogFormat(): LogFormat {
  return config.logFormat;
}

function renderLogfmtLine(level: LogLevel, message: string, fields?: LogFields): string {
  const sanitizedMessage = redactString(message);
  const sanitizedFields = sanitizeLogFields(fields);
  const timestamp = new Date().toISOString();
  const pairs = sanitizedFields
    ? Object.entries(sanitizedFields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${encodeLogfmtValue(value ?? null)}`)
    : [];
  const tail = pairs.length > 0 ? ` ${pairs.join(" ")}` : "";
  return `${timestamp} level=${level} msg="${sanitizedMessage.replace(/"/g, '\\"')}"${tail}\n`;
}

function renderJsonLine(level: LogLevel, message: string, fields?: LogFields): string {
  const sanitizedMessage = redactString(message);
  const sanitizedFields = sanitizeLogFields(fields);
  const body = {
    ts: new Date().toISOString(),
    level,
    msg: sanitizedMessage,
    ...sanitizedFields,
  };
  return `${JSON.stringify(body)}\n`;
}

export function renderLogLine(level: LogLevel, message: string, fields?: LogFields, format?: LogFormat): string {
  const resolvedFormat = format ?? resolveLogFormat();
  if (resolvedFormat === "json") return renderJsonLine(level, message, fields);
  return renderLogfmtLine(level, message, fields);
}

let logSink: ((line: string) => void) | null = null;

export function setLogSink(sink: ((line: string) => void) | null): void {
  logSink = sink;
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const line = renderLogLine(level, message, fields);
  if (logSink) {
    logSink(line);
    return;
  }
  if (level === "warn" || level === "error") {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

export function errorToLogFields(error: unknown, prefix = "error"): LogFields {
  if (!(error instanceof Error)) {
    return {
      [`${prefix}_type`]: typeof error,
      [`${prefix}_message`]: String(error),
    };
  }
  let cause: string | undefined;
  if (error.cause === undefined) {
    cause = undefined;
  } else if (error.cause instanceof Error) {
    cause = error.cause.message;
  } else {
    cause = String(error.cause);
  }
  return {
    [`${prefix}_name`]: error.name,
    [`${prefix}_message`]: error.message,
    [`${prefix}_stack`]: error.stack,
    [`${prefix}_cause`]: cause,
  };
}

export const log = {
  debug: (message: string, fields?: LogFields): void => write("debug", message, fields),
  info: (message: string, fields?: LogFields): void => write("info", message, fields),
  warn: (message: string, fields?: LogFields): void => write("warn", message, fields),
  error: (message: string, fields?: LogFields): void => write("error", message, fields),
};
