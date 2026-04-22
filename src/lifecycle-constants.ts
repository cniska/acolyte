export const VERBOSE_ONLY_EVENTS = new Set<string>(["lifecycle.tool.output", "lifecycle.tool.cache"]);

export const MAX_TOTAL_STEPS = 60;
export const MAX_TURN_STEPS = 30;
export const STEP_TIMEOUT_MS = 120_000;
export const MAX_UNKNOWN_ERRORS_PER_REQUEST = 2;
export const TOOL_TIMEOUT_MS = 10_000;
export const MAX_CONTEXT_TOKENS = 100_000;
export const MAX_CONSECUTIVE_TOOL_FAILURES = 3;
export const MAX_TOOL_RESULT_CHARS = 30_000;
export const MAX_RECENT_TURNS = 5;
