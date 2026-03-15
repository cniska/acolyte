export const TOOL_ERROR_CODES = {
  editFileMultiMatch: "E_EDIT_FILE_MULTI_MATCH",
  editFileBatchTooLarge: "E_EDIT_FILE_BATCH_TOO_LARGE",
  editFileFindTooLarge: "E_EDIT_FILE_FIND_TOO_LARGE",
  editFileFindNotFound: "E_EDIT_FILE_FIND_NOT_FOUND",
  editFileLineRangeTooLarge: "E_EDIT_FILE_LINE_RANGE_TOO_LARGE",
  editFileReplaceTooLarge: "E_EDIT_FILE_REPLACE_TOO_LARGE",
  editCodeNoMatch: "E_EDIT_CODE_NO_MATCH",
  editCodeReplacementMetaMismatch: "E_EDIT_CODE_REPLACEMENT_META_MISMATCH",
  editCodeUnsupportedFile: "E_EDIT_CODE_UNSUPPORTED_FILE",
  scanCodeUnsupportedFile: "E_SCAN_CODE_UNSUPPORTED_FILE",
} as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];

export const LIFECYCLE_ERROR_CODES = {
  timeout: "E_TIMEOUT",
  fileNotFound: "E_FILE_NOT_FOUND",
  guardBlocked: "E_GUARD_BLOCKED",
  unknown: "E_UNKNOWN",
} as const;
export type LifecycleErrorCode = (typeof LIFECYCLE_ERROR_CODES)[keyof typeof LIFECYCLE_ERROR_CODES];

export type ErrorCode = ToolErrorCode | LifecycleErrorCode;

export const ERROR_KINDS = {
  timeout: "timeout",
  fileNotFound: "file_not_found",
  guardBlocked: "guard_blocked",
  unknown: "unknown",
} as const;
export type ErrorKind = (typeof ERROR_KINDS)[keyof typeof ERROR_KINDS];
