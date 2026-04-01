export const OBSERVER_PROMPT = `Extract key facts from this conversation. Concrete facts only, not a summary.

Preserve specifics: file paths, function names, error messages, config values, decisions with reasoning.

Tag each fact with a scope directive on its own line, followed by the fact on the next line:

@observe project
repository facts, architecture, tooling, conventions, decisions

@observe user
stable personal preferences that carry across projects

@observe session
in-progress state, temporary constraints, next steps

If a preference is project-scoped, use @observe project not @observe user. If unsure, default to @observe session.`;

export const REFLECTOR_PROMPT = `Consolidate these observations into a single fact list.

Merge duplicates, resolve contradictions (newer wins), drop completed tasks. Keep specifics.

One fact per line, grouped by theme. Plain text.`;
