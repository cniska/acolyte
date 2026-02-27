import { describe, expect, test } from "bun:test";
import {
  buildStreamErrorDetail,
  categoryFromErrorCode,
  classifyErrorCategory,
  errorCodeFromCategory,
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
    const parsed = parseErrorInfo({ error: { message: "timeout", code: LIFECYCLE_ERROR_CODES.timeout } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.message).toBe("timeout");
    expect(parsed.value.code).toBe(LIFECYCLE_ERROR_CODES.timeout);
  });

  test("parseErrorInfo returns invalid payload for unsupported shapes", () => {
    const parsed = parseErrorInfo({ foo: "bar" });
    expect(parsed.ok).toBe(false);
  });

  test("classifyErrorCategory maps known message signals", () => {
    expect(classifyErrorCategory("step timed out after 120000ms")).toBe("timeout");
    expect(classifyErrorCategory("src/utils.ts does not exist")).toBe("file-not-found");
    expect(classifyErrorCategory("do not use shell commands as fallback")).toBe("guard-blocked");
    expect(classifyErrorCategory("something unexpected happened")).toBe("other");
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

  test("isEditFileMultiMatchSignal accepts code or legacy text signal", () => {
    expect(isEditFileMultiMatchSignal({ code: TOOL_ERROR_CODES.editFileMultiMatch, message: "any" })).toBe(true);
    expect(isEditFileMultiMatchSignal({ message: "Find text matched 4 locations", code: undefined })).toBe(true);
    expect(isEditFileMultiMatchSignal({ message: "random error", code: undefined })).toBe(false);
  });

  test("recoveryActionForError uses timeout and unknown budget", () => {
    expect(recoveryActionForError({ errorCode: LIFECYCLE_ERROR_CODES.timeout, unknownErrorCount: 0 }, 2)).toBe(
      "retry-timeout",
    );
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
    ).toMatchObject({ action: "retry-timeout", retryable: true });
    expect(
      recoveryDecisionForError({ errorCode: LIFECYCLE_ERROR_CODES.unknown, unknownErrorCount: 2 }, 2),
    ).toMatchObject({ action: "stop-unknown-budget", retryable: false });
  });

  test("buildStreamErrorDetail returns normalized structured payload", () => {
    const detail = buildStreamErrorDetail(
      {
        message: "request timed out after 30s",
        source: "server",
        unknownErrorCount: 1,
      },
      1,
    );
    expect(detail.errorCode).toBe(LIFECYCLE_ERROR_CODES.timeout);
    expect(detail.category).toBe("timeout");
    expect(detail.errorDetail).toMatchObject({
      code: LIFECYCLE_ERROR_CODES.timeout,
      category: "timeout",
      source: "server",
      retryable: true,
      recoveryAction: "retry-timeout",
    });
  });
});
