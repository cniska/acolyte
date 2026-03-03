import { z } from "zod";
import { unreachable } from "./assert";
import { domainIdSchema } from "./id-contract";
import type { StreamErrorDetail } from "./stream-error";
import {
  type ErrorCode,
  extractToolErrorCode,
  hasToolErrorCode,
  LIFECYCLE_ERROR_CODES,
  TOOL_ERROR_CODES,
} from "./tool-error-codes";

export type ErrorCategory = "timeout" | "file-not-found" | "guard-blocked" | "other";
export type ErrorSource = "generate" | "tool-result" | "tool-error" | "server";
export type AppError<TCode extends string = string, TMeta = unknown> = Error & { code: TCode; meta?: TMeta };
export type ParsedError = { message: string; code?: string };
export type ParseErrorResult = { ok: true; value: ParsedError } | { ok: false; error: "invalid_error_payload" };
export type RecoveryAction = "stop-unknown-budget" | "none";
export type RecoveryDecision = { action: RecoveryAction; retryable: boolean };
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

export function isEditFileMultiMatchError(errorMessage: string): boolean {
  return (
    hasToolErrorCode(errorMessage, TOOL_ERROR_CODES.editFileMultiMatch) ||
    /Find text matched \d+ locations?/i.test(errorMessage)
  );
}

export function isEditFileMultiMatchSignal(input: { code?: string; message: string }): boolean {
  return input.code === TOOL_ERROR_CODES.editFileMultiMatch || isEditFileMultiMatchError(input.message);
}

export function isFileNotFoundSignal(text: string): boolean {
  return /\b(?:does not exist|doesn't exist|no such file|not found|ENOENT)\b/i.test(text);
}

function isGuardBlockedSignal(text: string): boolean {
  return /cannot delete|do not use shell commands|repeated .* detected|already read .* this turn/i.test(text);
}

type ErrorCategoryRule = { category: ErrorCategory; matches: (message: string) => boolean };

const ERROR_CATEGORY_RULES: readonly ErrorCategoryRule[] = [
  { category: "timeout", matches: (message) => /timed out|timeout/i.test(message) },
  { category: "file-not-found", matches: isFileNotFoundSignal },
  { category: "guard-blocked", matches: isGuardBlockedSignal },
];

export function classifyErrorCategory(message: string): ErrorCategory {
  for (const rule of ERROR_CATEGORY_RULES) {
    if (rule.matches(message)) return rule.category;
  }
  return "other";
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
    return { ok: true, value: { message: value.message, code } };
  }
  if (typeof value === "object" && value !== null) {
    const rec = value as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof rec.message === "string") {
      const code = typeof rec.code === "string" ? rec.code : extractToolErrorCode(rec.message);
      return { ok: true, value: { message: rec.message, code } };
    }
    if (typeof rec.error === "string") {
      const code = typeof rec.code === "string" ? rec.code : extractToolErrorCode(rec.error);
      return { ok: true, value: { message: rec.error, code } };
    }
    if (rec.error !== undefined) return parseErrorInfo(rec.error);
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

export function recoveryDecisionForError(
  input: { errorCode?: string; unknownErrorCount: number },
  unknownErrorBudget: number,
): RecoveryDecision {
  const action = recoveryActionForError(input, unknownErrorBudget);
  return { action, retryable: false };
}

export function buildStreamErrorDetail(
  input: {
    message: string;
    code?: string;
    source?: ErrorSource;
    tool?: string;
    unknownErrorCount: number;
  },
  unknownErrorBudget: number,
): { errorCode: string; category: ErrorCategory; errorDetail: StreamErrorDetail } {
  const derivedCategory = classifyErrorCategory(input.message);
  const errorCode = input.code ?? extractToolErrorCode(input.message) ?? errorCodeFromCategory(derivedCategory);
  const category = categoryFromErrorCode(errorCode) ?? derivedCategory;
  const decision = recoveryDecisionForError(
    { errorCode, unknownErrorCount: input.unknownErrorCount },
    unknownErrorBudget,
  );
  return {
    errorCode,
    category,
    errorDetail: {
      code: errorCode,
      category,
      source: input.source,
      tool: input.tool,
      retryable: decision.retryable,
      recoveryAction: decision.action,
    },
  };
}
