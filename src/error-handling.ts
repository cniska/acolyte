import {
  type ErrorCode,
  extractToolErrorCode,
  hasToolErrorCode,
  LIFECYCLE_ERROR_CODES,
  TOOL_ERROR_CODES,
} from "./tool-error-codes";

export type ErrorCategory = "timeout" | "file-not-found" | "guard-blocked" | "other";
export type ParsedError = { message: string; code?: string };
export type ParseErrorResult = { ok: true; value: ParsedError } | { ok: false; error: "invalid_error_payload" };
export type RecoveryAction = "retry-timeout" | "stop-unknown-budget" | "none";

export function isEditFileMultiMatchError(errorMessage: string): boolean {
  return (
    hasToolErrorCode(errorMessage, TOOL_ERROR_CODES.editFileMultiMatch) ||
    /Find text matched \d+ locations?/i.test(errorMessage)
  );
}

export function isFileNotFoundSignal(text: string): boolean {
  return /\b(?:does not exist|doesn't exist|no such file|not found|ENOENT)\b/i.test(text);
}

function isGuardBlockedSignal(text: string): boolean {
  return /cannot delete|do not use shell commands|repeated .* detected/i.test(text);
}

export function classifyErrorCategory(message: string): ErrorCategory {
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (isFileNotFoundSignal(message)) return "file-not-found";
  if (isGuardBlockedSignal(message)) return "guard-blocked";
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
  }
}

export function parseErrorInfo(value: unknown): ParseErrorResult {
  if (typeof value === "string") {
    return { ok: true, value: { message: value, code: extractToolErrorCode(value) } };
  }
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
    if (rec.error !== undefined) {
      return parseErrorInfo(rec.error);
    }
  }
  return { ok: false, error: "invalid_error_payload" };
}

export function recoveryActionForError(
  input: { errorCode?: string; unknownErrorCount: number },
  unknownErrorBudget: number,
): RecoveryAction {
  if (input.errorCode === LIFECYCLE_ERROR_CODES.timeout) {
    return "retry-timeout";
  }
  if (input.errorCode === LIFECYCLE_ERROR_CODES.unknown && input.unknownErrorCount >= unknownErrorBudget) {
    return "stop-unknown-budget";
  }
  return "none";
}
