# Glossary

## Naming rules

- **Domain noun** (`Session`, `Task`): in-memory domain entity used by core logic.
- **`*Record`** (`SessionRecord`, `TaskRecord`): persisted storage shape.
- **`*Contract`** (`TaskContract`, `StatusContract`): boundary shape for protocol/config/transport.
- **`*Store`** (`SessionStore`, `TaskStore`): behavior interface for persistence operations.
- **`*Schema`** (`sessionSchema`, `taskSchema`): Zod runtime validator and source of truth for unions.
- **`*Input` / `*Output`**: operation-specific payload types.

## Core terms

- **Session**: one chat session (messages, model, token usage, timestamps).
- **SessionRecord**: persisted sessions payload (`sessions[]`, `activeSessionId`).
- **SessionStore**: read/write/create interface for session persistence.
- **Task**: lifecycle work request flowing through accept/queue/run/terminal states.
- **Guard**: pre-tool execution rule that may block calls.
- **Evaluator**: post-generation rule that accepts or requests regeneration.
- **Toolkit**: grouped domain tools exposed through adapters/composition.
