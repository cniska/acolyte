import { describe, expect, test } from "bun:test";
import {
  categoryFromErrorCode,
  categoryFromErrorKind,
  createErrorStats,
  createStreamError,
  errorCodeFromCategory,
  errorKindFromCategory,
  isEditFileFindNotFoundSignal,
  isEditFileMultiMatchSignal,
  isOversizedEditSnippetSignal,
  parseErrorInfo,
  recoveryActionForError,
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

  test("isEditFileFindNotFoundSignal accepts code or embedded error code", () => {
    expect(isEditFileFindNotFoundSignal({ code: TOOL_ERROR_CODES.editFileFindNotFound, message: "any" })).toBe(true);
    expect(
      isEditFileFindNotFoundSignal({
        message: `[${TOOL_ERROR_CODES.editFileFindNotFound}] Find text not found in file: return undefined;`,
        code: undefined,
      }),
    ).toBe(true);
    expect(isEditFileFindNotFoundSignal({ message: "random error", code: undefined })).toBe(false);
  });

  test("isOversizedEditSnippetSignal accepts code or embedded error code", () => {
    expect(isOversizedEditSnippetSignal({ code: TOOL_ERROR_CODES.editFileFindTooLarge, message: "any" })).toBe(true);
    expect(isOversizedEditSnippetSignal({ code: TOOL_ERROR_CODES.editFileReplaceTooLarge, message: "any" })).toBe(
      true,
    );
    expect(isOversizedEditSnippetSignal({ code: TOOL_ERROR_CODES.editFileLineRangeTooLarge, message: "any" })).toBe(
      true,
    );
    expect(
      isOversizedEditSnippetSignal({
        message: `[${TOOL_ERROR_CODES.editFileFindTooLarge}] find must be a short unique snippet`,
        code: undefined,
      }),
    ).toBe(true);
    expect(
      isOversizedEditSnippetSignal({
        message: `[${TOOL_ERROR_CODES.editFileReplaceTooLarge}] replace must contain only the changed region`,
        code: undefined,
      }),
    ).toBe(true);
    expect(
      isOversizedEditSnippetSignal({
        message: `[${TOOL_ERROR_CODES.editFileLineRangeTooLarge}] line-range edit would clear the entire file`,
        code: undefined,
      }),
    ).toBe(true);
    expect(isOversizedEditSnippetSignal({ message: "random error", code: undefined })).toBe(false);
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
