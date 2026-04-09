export const TOOL_ERROR_CODES = {
  sandboxViolation: "E_SANDBOX_VIOLATION",
  editFileMultiMatch: "E_EDIT_FILE_MULTI_MATCH",
  editFileBatchTooLarge: "E_EDIT_FILE_BATCH_TOO_LARGE",
  editFileFindTooLarge: "E_EDIT_FILE_FIND_TOO_LARGE",
  editFileFindNotFound: "E_EDIT_FILE_FIND_NOT_FOUND",
  editFileLineRangeTooLarge: "E_EDIT_FILE_LINE_RANGE_TOO_LARGE",
  editFileReplaceTooLarge: "E_EDIT_FILE_REPLACE_TOO_LARGE",
  editCodeNoMatch: "E_EDIT_CODE_NO_MATCH",
  editCodeReplacementMetaMismatch: "E_EDIT_CODE_REPLACEMENT_META_MISMATCH",
  editCodeUnsupportedFile: "E_EDIT_CODE_UNSUPPORTED_FILE",
  searchFilesEmptyScope: "E_SEARCH_FILES_EMPTY_SCOPE",
  searchFilesNoMatch: "E_SEARCH_FILES_NO_MATCH",
  scanCodeUnsupportedFile: "E_SCAN_CODE_UNSUPPORTED_FILE",
} as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];

export const LIFECYCLE_ERROR_CODES = {
  timeout: "E_TIMEOUT",
  fileNotFound: "E_FILE_NOT_FOUND",
  budgetExhausted: "E_BUDGET_EXHAUSTED",
  unknown: "E_UNKNOWN",
} as const;
export type LifecycleErrorCode = (typeof LIFECYCLE_ERROR_CODES)[keyof typeof LIFECYCLE_ERROR_CODES];

export const CLOUD_ERROR_CODES = {
  unauthorized: "E_CLOUD_UNAUTHORIZED",
  forbidden: "E_CLOUD_FORBIDDEN",
  requestFailed: "E_CLOUD_REQUEST_FAILED",
} as const;
export type CloudErrorCode = (typeof CLOUD_ERROR_CODES)[keyof typeof CLOUD_ERROR_CODES];

export type ErrorCode = ToolErrorCode | LifecycleErrorCode | CloudErrorCode;

export const ERROR_KINDS = {
  sandboxViolation: "sandbox_violation",
  timeout: "timeout",
  fileNotFound: "file_not_found",
  budgetExhausted: "budget_exhausted",
  unknown: "unknown",
} as const;
export type ErrorKind = (typeof ERROR_KINDS)[keyof typeof ERROR_KINDS];

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
