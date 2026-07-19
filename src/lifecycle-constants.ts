export const VERBOSE_ONLY_EVENTS = new Set<string>(["lifecycle.tool.output", "lifecycle.tool.cache"]);

export const MAX_TOOL_CALLS_PER_REQUEST = 300;
export const BUDGET_NOTICE_FRACTION = 0.9;
export const STEP_TIMEOUT_MS = 120_000;
export const MAX_UNKNOWN_ERRORS_PER_REQUEST = 2;
export const TOOL_TIMEOUT_MS = 10_000;
// Flat input budget for every model: a 200k shared window minus output headroom. Stays under the
// input cap of every provider that offers >=200k (incl. gpt-5's 272k input limit); below 200k the
// check is best-effort and the provider is the real enforcer. Acolyte leans on memory, not a large
// context window, so a low fixed ceiling is by design (see docs/lifecycle.md).
export const MAX_CONTEXT_INPUT_TOKENS = 170_000;
export const MAX_TOOL_RESULT_CHARS = 30_000;
export const MAX_RECENT_TURNS = 5;
