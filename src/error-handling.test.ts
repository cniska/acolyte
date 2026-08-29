import { describe, expect, test } from "bun:test";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES, MEMORY_ERROR_CODES, TOOL_ERROR_CODES } from "./error-contract";
import {
  categoryFromErrorCode,
  categoryFromErrorKind,
  createAppError,
  createErrorStats,
  createStreamError,
  errorCodeFromCategory,
  errorKindFromCategory,
  errorKindFromErrorCode,
  parseError,
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

  test("createStreamError preserves the embedding-unavailable kind", () => {
    const detail = createStreamError({
      message: "memory recall needs an API key",
      code: MEMORY_ERROR_CODES.embeddingUnavailable,
      source: "server",
    });
    expect(detail.error).toMatchObject({
      code: MEMORY_ERROR_CODES.embeddingUnavailable,
      category: "other",
      kind: ERROR_KINDS.embeddingUnavailable,
      source: "server",
    });
  });

  test("every tool error code carries a kind more precise than unknown", () => {
    const unclassified = Object.values(TOOL_ERROR_CODES).filter(
      (code) => (errorKindFromErrorCode(code) ?? "unknown") === "unknown",
    );

    expect(unclassified).toEqual([]);
  });

  test("tool error codes separate a missing match from an oversized input", () => {
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.searchFilesNoMatch)).toBe("no_match");
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.editFileFindNotFound)).toBe("no_match");
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.editFileMultiMatch)).toBe("ambiguous_match");
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.readFileTooLarge)).toBe("too_large");
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.scanCodeUnsupportedFile)).toBe("unsupported_file");
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.readFileRangeInvalid)).toBe("invalid_request");
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.sandboxViolation)).toBe("sandbox_violation");
  });

  test("an ambiguous rename target is not classified as a missing match", () => {
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.editCodeAmbiguousTarget)).toBe("ambiguous_match");
    expect(errorKindFromErrorCode(TOOL_ERROR_CODES.editCodeNoMatch)).toBe("no_match");
  });

  test("a code naming an inherited object property resolves to no kind", () => {
    // A tool payload supplies this string unchecked, so a prototype member must not answer for a code.
    expect(errorKindFromErrorCode("toString")).toBeUndefined();
    expect(errorKindFromErrorCode("constructor")).toBeUndefined();
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
