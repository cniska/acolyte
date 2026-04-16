export const TOOL_PROGRESS_LIMITS = {
  files: 5,
  inlineFiles: 3,
} as const;

export const MAX_READ_PATHS = 5;

export const CLI_TOOL_OUTPUT_LIMITS = {
  files: 5,
  run: 5,
  read: 48,
  diff: 64,
  status: 6,
} as const;
