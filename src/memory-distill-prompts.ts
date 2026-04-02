export const OBSERVER_PROMPT = `Extract concrete facts from this conversation.

Preserve specifics: file paths, function names, error messages, config values, decisions with reasoning.

Tag each fact with an observe directive on its own line, followed by the fact on the next line:

@observe project
repository facts, architecture, tooling, conventions, decisions

@observe user
stable personal preferences that carry across projects

@observe session
in-progress state, temporary constraints, next steps

If a preference is project-scoped, use @observe project not @observe user. If unsure, default to @observe session.`;
