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
  serializeToolError,
} from "./error-handling";
import { createToolError } from "./tool-error";

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

  test("parseError preserves structured tool recovery metadata", () => {
    const parsed = parseError(
      createToolError(TOOL_ERROR_CODES.editFileFindNotFound, "stale find", undefined, {
        tool: "edit-file",
        kind: "refresh-snippet",
        summary: "Refresh the snippet.",
        instruction: "Reread the file and rebuild the edit.",
        nextTool: "read-file",
        targetPaths: ["src/a.ts"],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recovery).toEqual({
      tool: "edit-file",
      kind: "refresh-snippet",
      summary: "Refresh the snippet.",
      instruction: "Reread the file and rebuild the edit.",
      nextTool: "read-file",
      targetPaths: ["src/a.ts"],
    });
  });

  test("serializeToolError preserves structured tool recovery metadata", () => {
    expect(
      serializeToolError(
        createToolError(TOOL_ERROR_CODES.editFileFindTooLarge, "find too large", undefined, {
          tool: "edit-file",
          kind: "shrink-edit",
          summary: "Shrink the edit.",
          instruction: "Use smaller snippets.",
          nextTool: "edit-file",
          targetPaths: ["src/a.ts"],
        }),
      ),
    ).toEqual({
      error: {
        message: "find too large",
        code: TOOL_ERROR_CODES.editFileFindTooLarge,
        recovery: {
          tool: "edit-file",
          kind: "shrink-edit",
          summary: "Shrink the edit.",
          instruction: "Use smaller snippets.",
          nextTool: "edit-file",
          targetPaths: ["src/a.ts"],
        },
      },
    });
  });

  test("parseError preserves structured edit-code recovery metadata", () => {
    const parsed = parseError(
      createToolError(TOOL_ERROR_CODES.editCodeNoMatch, "No AST matches found", undefined, {
        tool: "edit-code",
        kind: "refine-pattern",
        summary: "Your AST pattern did not match the current file.",
        instruction: "Refine the pattern from the latest read-file output.",
        nextTool: "read-file",
        targetPaths: ["src/code-ops.ts"],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recovery).toEqual({
      tool: "edit-code",
      kind: "refine-pattern",
      summary: "Your AST pattern did not match the current file.",
      instruction: "Refine the pattern from the latest read-file output.",
      nextTool: "read-file",
      targetPaths: ["src/code-ops.ts"],
    });
  });

  test("serializeToolError preserves structured edit-code recovery metadata", () => {
    expect(
      serializeToolError(
        createToolError(TOOL_ERROR_CODES.editCodeUnsupportedFile, "unsupported file", undefined, {
          tool: "edit-code",
          kind: "use-supported-file",
          summary: "edit-code only works on supported code files.",
          instruction: "Use a supported code file or switch to edit-file.",
          nextTool: "edit-file",
          targetPaths: ["notes.md"],
        }),
      ),
    ).toEqual({
      error: {
        message: "unsupported file",
        code: TOOL_ERROR_CODES.editCodeUnsupportedFile,
        recovery: {
          tool: "edit-code",
          kind: "use-supported-file",
          summary: "edit-code only works on supported code files.",
          instruction: "Use a supported code file or switch to edit-file.",
          nextTool: "edit-file",
          targetPaths: ["notes.md"],
        },
      },
    });
  });

  test("parseError preserves structured scan-code recovery metadata", () => {
    const parsed = parseError(
      createToolError(TOOL_ERROR_CODES.scanCodeUnsupportedFile, "unsupported file", undefined, {
        tool: "scan-code",
        kind: "use-supported-file",
        summary: "scan-code only works on supported code files.",
        instruction: "Use scan-code on a supported code file or directory, or switch to search-files.",
        nextTool: "search-files",
        targetPaths: ["config/models.yaml"],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recovery).toEqual({
      tool: "scan-code",
      kind: "use-supported-file",
      summary: "scan-code only works on supported code files.",
      instruction: "Use scan-code on a supported code file or directory, or switch to search-files.",
      nextTool: "search-files",
      targetPaths: ["config/models.yaml"],
    });
  });

  test("parseError preserves structured search-files recovery metadata", () => {
    const parsed = parseError(
      createToolError(TOOL_ERROR_CODES.searchFilesEmptyScope, "empty search scope", undefined, {
        tool: "search-files",
        kind: "broaden-scope",
        summary: "Your search-files scope resolved to no searchable files.",
        instruction: "Broaden the scope or use find-files first.",
        nextTool: "find-files",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recovery).toEqual({
      tool: "search-files",
      kind: "broaden-scope",
      summary: "Your search-files scope resolved to no searchable files.",
      instruction: "Broaden the scope or use find-files first.",
      nextTool: "find-files",
    });
  });

  test("parseError preserves structured scoped no-match search-files recovery metadata", () => {
    const parsed = parseError(
      createToolError(TOOL_ERROR_CODES.searchFilesNoMatch, "no match in scoped file", undefined, {
        tool: "search-files",
        kind: "switch-to-read",
        summary: "Your search-files query found no matches in the scoped file.",
        instruction: "Switch to read-file and inspect the file directly.",
        nextTool: "read-file",
        targetPaths: ["src/provider-config.ts"],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recovery).toEqual({
      tool: "search-files",
      kind: "switch-to-read",
      summary: "Your search-files query found no matches in the scoped file.",
      instruction: "Switch to read-file and inspect the file directly.",
      nextTool: "read-file",
      targetPaths: ["src/provider-config.ts"],
    });
  });

  test("parseError drops invalid tool recovery hints", () => {
    const parsed = parseError({
      error: {
        message: "unsupported file",
        code: TOOL_ERROR_CODES.scanCodeUnsupportedFile,
        recovery: {
          tool: "scan-code",
          kind: "use-supported-file",
          summary: "scan-code only works on supported code files.",
          instruction: "Use search-files instead.",
          nextTool: "run-command",
          targetPaths: ["config/models.yaml", "", 42],
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recovery).toEqual({
      tool: "scan-code",
      kind: "use-supported-file",
      summary: "scan-code only works on supported code files.",
      instruction: "Use search-files instead.",
      targetPaths: ["config/models.yaml"],
    });
  });

  test("parseError returns invalid payload for unsupported shapes", () => {
    const parsed = parseError({ foo: "bar" });
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
