import { describe, expect, test } from "bun:test";
import {
  buildStreamErrorDetail,
  categoryFromErrorCode,
  categoryFromErrorKind,
  createErrorStats,
  errorCodeFromCategory,
  errorKindFromCategory,
  isEditFileMultiMatchSignal,
  parseErrorInfo,
  recoveryActionForError,
  recoveryDecisionForError,
} from "./error-handling";
import { LIFECYCLE_ERROR_CODES, TOOL_ERROR_CODES } from "./tool-error-codes";

describe("error handling helpers", () => {
  test("parseErrorInfo extracts code from coded string", () => {
    const parsed = parseErrorInfo(`[E_EDIT_FILE_MULTI_MATCH] Find text matched 3 locations`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.code).toBe(TOOL_ERROR_CODES.editFileMultiMatch);
  });

  test("parseErrorInfo handles nested object payload", () => {
    const parsed = parseErrorInfo({
      error: { message: "timeout", code: LIFECYCLE_ERROR_CODES.timeout, kind: "timeout" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.message).toBe("timeout");
    expect(parsed.value.code).toBe(LIFECYCLE_ERROR_CODES.timeout);
    expect(parsed.value.kind).toBe("timeout");
  });

  test("parseErrorInfo returns invalid payload for unsupported shapes", () => {
    const parsed = parseErrorInfo({ foo: "bar" });
    expect(parsed.ok).toBe(false);
  });

  test("category/code mapping is stable for lifecycle codes", () => {
    expect(categoryFromErrorCode(LIFECYCLE_ERROR_CODES.timeout)).toBe("timeout");
    expect(categoryFromErrorCode(LIFECYCLE_ERROR_CODES.fileNotFound)).toBe("file-not-found");
    expect(categoryFromErrorCode(LIFECYCLE_ERROR_CODES.guardBlocked)).toBe("guard-blocked");
    expect(categoryFromErrorCode(LIFECYCLE_ERROR_CODES.unknown)).toBe("other");

    expect(errorCodeFromCategory("timeout")).toBe(LIFECYCLE_ERROR_CODES.timeout);
    expect(errorCodeFromCategory("file-not-found")).toBe(LIFECYCLE_ERROR_CODES.fileNotFound);
    expect(errorCodeFromCategory("guard-blocked")).toBe(LIFECYCLE_ERROR_CODES.guardBlocked);
    expect(errorCodeFromCategory("other")).toBe(LIFECYCLE_ERROR_CODES.unknown);
  });

  test("category/kind mapping is stable", () => {
    expect(categoryFromErrorKind("timeout")).toBe("timeout");
    expect(categoryFromErrorKind("file_not_found")).toBe("file-not-found");
    expect(categoryFromErrorKind("guard_blocked")).toBe("guard-blocked");
    expect(categoryFromErrorKind("unknown")).toBe("other");

    expect(errorKindFromCategory("timeout")).toBe("timeout");
    expect(errorKindFromCategory("file-not-found")).toBe("file_not_found");
    expect(errorKindFromCategory("guard-blocked")).toBe("guard_blocked");
    expect(errorKindFromCategory("other")).toBe("unknown");
  });

  test("isEditFileMultiMatchSignal accepts code or embedded error code", () => {
    expect(isEditFileMultiMatchSignal({ code: TOOL_ERROR_CODES.editFileMultiMatch, message: "any" })).toBe(true);
    expect(
      isEditFileMultiMatchSignal({
        message: `[${TOOL_ERROR_CODES.editFileMultiMatch}] Find text matched 4 locations`,
        code: undefined,
      }),
    ).toBe(true);
    expect(isEditFileMultiMatchSignal({ message: "random error", code: undefined })).toBe(false);
  });

  test("recoveryActionForError uses unknown budget only", () => {
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.timeout, unknownErrorCount: 0 }, 2)).toBe("none");
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.unknown, unknownErrorCount: 2 }, 2)).toBe(
      "stop-unknown-budget",
    );
    expect(recoveryActionForError({ errorCode: TOOL_ERROR_CODES.editFileMultiMatch, unknownErrorCount: 0 }, 2)).toBe(
      "none",
    );
  });

  test("recoveryDecisionForError marks retryability", () => {
    expect(
      recoveryDecisionForError({ errorCode: LIFECYCLE_ERROR_CODES.timeout, unknownErrorCount: 0 }, 2),
    ).toMatchObject({ action: "none", retryable: false });
    expect(
      recoveryDecisionForError({ errorCode: LIFECYCLE_ERROR_CODES.unknown, unknownErrorCount: 2 }, 2),
    ).toMatchObject({ action: "stop-unknown-budget", retryable: false });
  });

  test("buildStreamErrorDetail returns normalized structured payload", () => {
    const detail = buildStreamErrorDetail(
      {
        message: "request timed out after 30s",
        code: LIFECYCLE_ERROR_CODES.timeout,
        source: "server",
        unknownErrorCount: 0,
      },
      2,
    );
    expect(detail.errorCode).toBe(LIFECYCLE_ERROR_CODES.timeout);
    expect(detail.category).toBe("timeout");
    expect(detail.errorDetail).toMatchObject({
      code: LIFECYCLE_ERROR_CODES.timeout,
      category: "timeout",
      kind: "timeout",
      source: "server",
      retryable: false,
      recoveryAction: "none",
    });
  });

  test("createErrorStats initializes all known categories", () => {
    expect(createErrorStats()).toEqual({
      timeout: 0,
      "file-not-found": 0,
      "guard-blocked": 0,
      other: 0,
    });
    expect(createErrorStats(2)).toEqual({
      timeout: 2,
      "file-not-found": 2,
      "guard-blocked": 2,
      other: 2,
    });
  });
});
