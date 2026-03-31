import { describe, expect, test } from "bun:test";
import { LIFECYCLE_ERROR_CODES, TOOL_ERROR_CODES } from "./error-contract";
import {
  categoryFromErrorCode,
  categoryFromErrorKind,
  createAppError,
  createErrorStats,
  createStreamError,
  errorCodeFromCategory,
  errorKindFromCategory,
  parseError,
  recoveryActionForError,
} from "./error-handling";

describe("error handling helpers", () => {
  test("createAppError returns a coded runtime error with meta", () => {
    const error = createAppError("E_TEST", "boom", { source: "unit" });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("E_TEST");
    expect(error.meta).toEqual({ source: "unit" });
  });

  test("parseError extracts code from coded string", () => {
    const parsed = parseError(`[E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.code).toBe(TOOL_ERROR_CODES.editFileMultiMatch);
  });

  test("parseError handles nested object payload", () => {
    const parsed = parseError({
      error: { message: "timeout", code: LIFECYCLE_ERROR_CODES.timeout, kind: "timeout" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.message).toBe("timeout");
    expect(parsed.value.code).toBe(LIFECYCLE_ERROR_CODES.timeout);
    expect(parsed.value.kind).toBe("timeout");
  });

  test("parseError returns invalid payload for unsupported shapes", () => {
    const parsed = parseError({ foo: "bar" });
    expect(parsed.ok).toBe(false);
  });

  test("category/code mapping is stable for lifecycle codes", () => {
    expect(categoryFromErrorCode(LIFECYCLE_ERROR_CODES.timeout)).toBe("timeout");
    expect(categoryFromErrorCode(LIFECYCLE_ERROR_CODES.fileNotFound)).toBe("file-not-found");
    expect(categoryFromErrorCode(LIFECYCLE_ERROR_CODES.budgetExhausted)).toBe("budget-exhausted");
    expect(categoryFromErrorCode(LIFECYCLE_ERROR_CODES.unknown)).toBe("other");

    expect(errorCodeFromCategory("timeout")).toBe(LIFECYCLE_ERROR_CODES.timeout);
    expect(errorCodeFromCategory("file-not-found")).toBe(LIFECYCLE_ERROR_CODES.fileNotFound);
    expect(errorCodeFromCategory("budget-exhausted")).toBe(LIFECYCLE_ERROR_CODES.budgetExhausted);
    expect(errorCodeFromCategory("other")).toBe(LIFECYCLE_ERROR_CODES.unknown);
  });

  test("category/kind mapping is stable", () => {
    expect(categoryFromErrorKind("timeout")).toBe("timeout");
    expect(categoryFromErrorKind("file_not_found")).toBe("file-not-found");
    expect(categoryFromErrorKind("budget_exhausted")).toBe("budget-exhausted");
    expect(categoryFromErrorKind("unknown")).toBe("other");

    expect(errorKindFromCategory("timeout")).toBe("timeout");
    expect(errorKindFromCategory("file-not-found")).toBe("file_not_found");
    expect(errorKindFromCategory("budget-exhausted")).toBe("budget_exhausted");
    expect(errorKindFromCategory("other")).toBe("unknown");
  });

  test("recoveryActionForError uses unknown budget only", () => {
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.timeout, unknownErrorCount: 0 }, 2)).toBe("none");
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.unknown, unknownErrorCount: 2 }, 2)).toBe(
      "stop-unknown-budget",
    );
    expect(recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileMultiMatch, unknownErrorCount: 0 }, 2)).toBe(
      "none",
    );
    expect(recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileFindNotFound, unknownErrorCount: 2 }, 2)).toBe(
      "none",
    );
    expect(recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileBatchTooLarge, unknownErrorCount: 2 }, 2)).toBe(
      "none",
    );
    expect(recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileFindTooLarge, unknownErrorCount: 2 }, 2)).toBe(
      "none",
    );
    expect(
      recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileReplaceTooLarge, unknownErrorCount: 2 }, 2),
    ).toBe("none");
    expect(
      recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileLineRangeTooLarge, unknownErrorCount: 2 }, 2),
    ).toBe("none");
  });

  test("recoveryActionForError returns action based on error budget", () => {
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.timeout, unknownErrorCount: 0 }, 2)).toBe("none");
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.unknown, unknownErrorCount: 2 }, 2)).toBe(
      "stop-unknown-budget",
    );
  });

  test("createStreamError returns normalized structured payload", () => {
    const detail = createStreamError({
      message: "request timed out after 30s",
      code: LIFECYCLE_ERROR_CODES.timeout,
      source: "server",
    });
    expect(detail.errorCode).toBe(LIFECYCLE_ERROR_CODES.timeout);
    expect(detail.category).toBe("timeout");
    expect(detail.error).toMatchObject({
      code: LIFECYCLE_ERROR_CODES.timeout,
      category: "timeout",
      kind: "timeout",
      source: "server",
    });
  });

  test("createErrorStats initializes all known categories", () => {
    expect(createErrorStats()).toEqual({
      timeout: 0,
      "file-not-found": 0,
      "budget-exhausted": 0,
      other: 0,
    });
    expect(createErrorStats(2)).toEqual({
      timeout: 2,
      "file-not-found": 2,
      "budget-exhausted": 2,
      other: 2,
    });
  });
});
