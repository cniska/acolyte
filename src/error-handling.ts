import type { z } from "zod";
import { unreachable } from "./assert";
import { domainIdSchema } from "./id-contract";
import type { StreamError } from "./stream-error";
import {
  ERROR_KINDS,
  type ErrorCode,
  type ErrorKind,
  extractToolErrorCode,
  hasToolErrorCode,
  LIFECYCLE_ERROR_CODES,
  TOOL_ERROR_CODES,
} from "./tool-error-codes";

export type ErrorCategory = "timeout" | "file-not-found" | "guard-blocked" | "other";
export type ErrorSource = "generate" | "tool-result" | "tool-error" | "server";
export type AppError<TCode extends string = string, TMeta = unknown> = Error & { code: TCode; meta?: TMeta };
export type ParsedError = { message: string; code?: string; kind?: string };
export type ParseErrorResult = { ok: true; value: ParsedError } | { ok: false; error: "invalid_error_payload" };
export type RecoveryAction = "stop-unknown-budget" | "none";
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

export function isEditFileMultiMatchSignal(input: { code?: string; message: string }): boolean {
  return (
    input.code === TOOL_ERROR_CODES.editFileMultiMatch ||
    hasToolErrorCode(input.message, TOOL_ERROR_CODES.editFileMultiMatch)
  );
}

export function isEditFileFindNotFoundSignal(input: { code?: string; message: string }): boolean {
  return (
    input.code === TOOL_ERROR_CODES.editFileFindNotFound ||
    hasToolErrorCode(input.message, TOOL_ERROR_CODES.editFileFindNotFound)
  );
}

export function isOversizedEditSnippetSignal(input: { code?: string; message: string }): boolean {
  return (
    input.code === TOOL_ERROR_CODES.editFileBatchTooLarge ||
    input.code === TOOL_ERROR_CODES.editFileFindTooLarge ||
    input.code === TOOL_ERROR_CODES.editFileReplaceTooLarge ||
    input.code === TOOL_ERROR_CODES.editFileLineRangeTooLarge ||
    hasToolErrorCode(input.message, TOOL_ERROR_CODES.editFileBatchTooLarge) ||
    hasToolErrorCode(input.message, TOOL_ERROR_CODES.editFileLineRangeTooLarge) ||
    hasToolErrorCode(input.message, TOOL_ERROR_CODES.editFileReplaceTooLarge) ||
    hasToolErrorCode(input.message, TOOL_ERROR_CODES.editFileFindTooLarge)
  );
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

export function parseErrorInfo(value: unknown): ParseErrorResult {
  if (typeof value === "string") return { ok: true, value: { message: value, code: extractToolErrorCode(value) } };
  if (value instanceof Error) {
    const code = "code" in value && typeof value.code === "string" ? value.code : extractToolErrorCode(value.message);
    const kind = "kind" in value && typeof value.kind === "string" ? value.kind : undefined;
    return { ok: true, value: { message: value.message, code, kind } };
  }
  if (typeof value === "object" && value !== null) {
    const rec = value as { message?: unknown; error?: unknown; code?: unknown; kind?: unknown };
    if (typeof rec.message === "string") {
      const code = typeof rec.code === "string" ? rec.code : extractToolErrorCode(rec.message);
      const kind = typeof rec.kind === "string" ? rec.kind : undefined;
      return { ok: true, value: { message: rec.message, code, kind } };
    }
    if (typeof rec.error === "string") {
      const code = typeof rec.code === "string" ? rec.code : extractToolErrorCode(rec.error);
      const kind = typeof rec.kind === "string" ? rec.kind : undefined;
      return { ok: true, value: { message: rec.error, code, kind } };
    }
    if (rec.error !== undefined) {
      const nested = parseErrorInfo(rec.error);
      if (!nested.ok) return nested;
      return {
        ok: true,
        value: {
          ...nested.value,
          code: typeof rec.code === "string" ? rec.code : nested.value.code,
          kind: typeof rec.kind === "string" ? rec.kind : nested.value.kind,
        },
      };
    }
  }
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
