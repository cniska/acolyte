// Human-facing display caps for tool progress and CLI rendering.
// These do not affect tool execution or agent-visible result payloads.
export const TOOL_PROGRESS_LIMITS = {
  files: 5,
  inlineFiles: 3,
} as const;

export const CLI_TOOL_OUTPUT_LIMITS = {
  files: 5,
  run: 5,
  read: 48,
  diff: 64,
  status: 6,
} as const;
