import type { z } from "zod";
import { unreachable } from "./assert";
import { ERROR_KINDS, type ErrorCode, type ErrorKind, LIFECYCLE_ERROR_CODES } from "./error-primitives";
import { domainIdSchema } from "./id-contract";
import type { StreamError } from "./stream-error";
import { extractToolErrorCode } from "./tool-error";
import { parseToolRecovery, type ToolRecovery } from "./tool-recovery";

export type ErrorCategory = "timeout" | "file-not-found" | "guard-blocked" | "other";
export type ErrorSource = "generate" | "tool-result" | "tool-error" | "server";
export type AppError<TCode extends string = string, TMeta = unknown> = Error & { code: TCode; meta?: TMeta };
export type ParsedError = { message: string; code?: string; kind?: string; recovery?: ToolRecovery };
export type ParseErrorResult = { ok: true; value: ParsedError } | { ok: false; error: "invalid_error_payload" };
export type RecoveryAction = "stop-unknown-budget" | "none";
export type SerializedToolError = {
  error: {
    message: string;
    code?: string;
    kind?: string;
    recovery?: ToolRecovery;
  };
};
export const ERROR_CATEGORIES = ["timeout", "file-not-found", "guard-blocked", "other"] as const;
export const errorIdSchema = domainIdSchema("err");
export type ErrorId = z.infer<typeof errorIdSchema>;

export function createAppError<TCode extends string, TMeta = unknown>(
  code: TCode,
  message: string,
  meta?: TMeta,
): AppError<TCode, TMeta> {
  const error = new Error(message) as AppError<TCode, TMeta>;
  error.code = code;
  if (meta !== undefined) error.meta = meta;
  return error;
}

export function createErrorStats(initialValue = 0): Record<ErrorCategory, number> {
  return Object.fromEntries(ERROR_CATEGORIES.map((category) => [category, initialValue])) as Record<
    ErrorCategory,
    number
  >;
}

export function categoryFromErrorCode(code?: string): ErrorCategory | undefined {
  switch (code) {
    case LIFECYCLE_ERROR_CODES.timeout:
      return "timeout";
    case LIFECYCLE_ERROR_CODES.fileNotFound:
      return "file-not-found";
    case LIFECYCLE_ERROR_CODES.guardBlocked:
      return "guard-blocked";
    case LIFECYCLE_ERROR_CODES.unknown:
      return "other";
    default:
      return undefined;
  }
}

export function categoryFromErrorKind(kind?: string): ErrorCategory | undefined {
  switch (kind) {
    case ERROR_KINDS.timeout:
      return "timeout";
    case ERROR_KINDS.fileNotFound:
      return "file-not-found";
    case ERROR_KINDS.guardBlocked:
      return "guard-blocked";
    case ERROR_KINDS.unknown:
      return "other";
    default:
      return undefined;
  }
}

export function errorKindFromCategory(category: ErrorCategory): ErrorKind {
  switch (category) {
    case "timeout":
      return ERROR_KINDS.timeout;
    case "file-not-found":
      return ERROR_KINDS.fileNotFound;
    case "guard-blocked":
      return ERROR_KINDS.guardBlocked;
    case "other":
      return ERROR_KINDS.unknown;
    default:
      return unreachable(category);
  }
}

export function errorCodeFromCategory(category: ErrorCategory): ErrorCode {
  switch (category) {
    case "timeout":
      return LIFECYCLE_ERROR_CODES.timeout;
    case "file-not-found":
      return LIFECYCLE_ERROR_CODES.fileNotFound;
    case "guard-blocked":
      return LIFECYCLE_ERROR_CODES.guardBlocked;
    case "other":
      return LIFECYCLE_ERROR_CODES.unknown;
    default:
      return unreachable(category);
  }
}

export function parseError(value: unknown): ParseErrorResult {
  if (typeof value === "string") return { ok: true, value: parseMessageFields(value) };
  if (value instanceof Error) return { ok: true, value: parseErrorInstance(value) };
  if (typeof value === "object" && value !== null) return parseErrorObject(value);
  return { ok: false, error: "invalid_error_payload" };
}

export function recoveryActionForError(
  input: { errorCode?: string; unknownErrorCount: number },
  unknownErrorBudget: number,
): RecoveryAction {
  if (input.errorCode === LIFECYCLE_ERROR_CODES.unknown && input.unknownErrorCount >= unknownErrorBudget)
    return "stop-unknown-budget";
  return "none";
}

export function serializeToolError(value: unknown): SerializedToolError {
  const parsed = parseError(value);
  if (!parsed.ok) return { error: { message: "Tool error" } };
  const { message, code, kind, recovery } = parsed.value;
  return {
    error: {
      message,
      ...(code ? { code } : {}),
      ...(kind ? { kind } : {}),
      ...(recovery ? { recovery } : {}),
    },
  };
}

function parseMessageFields(
  message: string,
  overrides?: { code?: unknown; kind?: unknown; recovery?: unknown },
): ParsedError {
  return {
    message,
    code: typeof overrides?.code === "string" ? overrides.code : extractToolErrorCode(message),
    kind: typeof overrides?.kind === "string" ? overrides.kind : undefined,
    recovery: parseToolRecovery(overrides?.recovery),
  };
}

function parseErrorInstance(error: Error): ParsedError {
  return parseMessageFields(error.message, {
    code: "code" in error ? error.code : undefined,
    kind: "kind" in error ? error.kind : undefined,
    recovery: "recovery" in error ? error.recovery : undefined,
  });
}

function parseErrorObject(value: object): ParseErrorResult {
  const rec = value as { message?: unknown; error?: unknown; code?: unknown; kind?: unknown; recovery?: unknown };
  if (typeof rec.message === "string") return { ok: true, value: parseMessageFields(rec.message, rec) };
  if (typeof rec.error === "string") return { ok: true, value: parseMessageFields(rec.error, rec) };
  if (rec.error === undefined) return { ok: false, error: "invalid_error_payload" };
  const nested = parseError(rec.error);
  if (!nested.ok) return nested;
  return {
    ok: true,
    value: {
      ...nested.value,
      code: typeof rec.code === "string" ? rec.code : nested.value.code,
      kind: typeof rec.kind === "string" ? rec.kind : nested.value.kind,
      recovery: parseToolRecovery(rec.recovery) ?? nested.value.recovery,
    },
  };
}

export function createStreamError(input: {
  message: string;
  code?: string;
  kind?: string;
  source?: ErrorSource;
  tool?: string;
}): { errorCode: string; category: ErrorCategory; error: StreamError } {
  const kindCategory = categoryFromErrorKind(input.kind);
  const errorCode =
    input.code ??
    extractToolErrorCode(input.message) ??
    (kindCategory ? errorCodeFromCategory(kindCategory) : undefined) ??
    LIFECYCLE_ERROR_CODES.unknown;
  const category = categoryFromErrorCode(errorCode) ?? kindCategory ?? "other";
  const errorKind = input.kind ?? errorKindFromCategory(category);
  return {
    errorCode,
    category,
    error: {
      code: errorCode,
      category,
      kind: errorKind,
      source: input.source,
      tool: input.tool,
    },
  };
}
