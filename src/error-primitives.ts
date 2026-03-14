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
  editCodeVariadicReplacement: "E_EDIT_CODE_VARIADIC_REPLACEMENT",
} as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];
export type EditFileRecoveryKind = "disambiguate-match" | "refresh-snippet" | "shrink-edit";
export const EDIT_FILE_RECOVERY_KINDS: readonly EditFileRecoveryKind[] = [
  "disambiguate-match",
  "refresh-snippet",
  "shrink-edit",
];
export type EditFileRecovery = {
  tool: "edit-file";
  kind: EditFileRecoveryKind;
  summary: string;
  instruction: string;
};
export type EditCodeRecoveryKind = "fix-replacement" | "refine-pattern" | "use-supported-file";
export const EDIT_CODE_RECOVERY_KINDS: readonly EditCodeRecoveryKind[] = [
  "fix-replacement",
  "refine-pattern",
  "use-supported-file",
];
export type EditCodeRecovery = {
  tool: "edit-code";
  kind: EditCodeRecoveryKind;
  summary: string;
  instruction: string;
};
export type ToolRecovery = EditFileRecovery | EditCodeRecovery;

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
  recovery?: ToolRecovery;

  constructor(code: string, message: string, kind?: ErrorKind, recovery?: ToolRecovery) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.kind = kind;
    this.recovery = recovery;
  }
}

export function createToolError(code: string, message: string, kind?: ErrorKind, recovery?: ToolRecovery): ToolError {
  return new ToolError(code, message, kind, recovery);
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
