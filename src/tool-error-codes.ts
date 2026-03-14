export const TOOL_ERROR_CODES = {
  editFileMultiMatch: "E_EDIT_FILE_MULTI_MATCH",
  editFileBatchTooLarge: "E_EDIT_FILE_BATCH_TOO_LARGE",
  editFileFindTooLarge: "E_EDIT_FILE_FIND_TOO_LARGE",
  editFileFindNotFound: "E_EDIT_FILE_FIND_NOT_FOUND",
  editFileLineRangeTooLarge: "E_EDIT_FILE_LINE_RANGE_TOO_LARGE",
  editFileReplaceTooLarge: "E_EDIT_FILE_REPLACE_TOO_LARGE",
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

export class ToolError extends Error {
  code: string;
  kind?: ErrorKind;

  constructor(code: string, message: string, kind?: ErrorKind) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.kind = kind;
  }
}

export function createToolError(code: string, message: string, kind?: ErrorKind): ToolError {
  return new ToolError(code, message, kind);
}

export function encodeToolError(code: string, message: string): string {
  return `[${code}] ${message}`;
}

export function hasToolErrorCode(message: string, code: string): boolean {
  return message.includes(`[${code}]`);
}

export function extractToolErrorCode(message: string): string | undefined {
  const match = message.match(/\[([A-Z0-9_]+)\]/);
  return match?.[1];
}
