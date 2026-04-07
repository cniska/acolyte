# Sessions

A session tracks chat context and message history across requests.

## Model

- each session has a unique ID (`sess_*`), model, title, and message history
- one active task runs at a time per session
- session state persists outside lifecycle and is passed in per request
- messages are appended during chat and persisted at checkpoints
- token usage is tracked per response with optional prompt breakdown

## Lifecycle

```text
create or resume → lock → chat → persist → release
```

- **create**: new session with empty messages, assigned `sess_*` ID
- **resume**: load existing session by ID prefix or active session
- **lock**: file-based PID lock prevents concurrent modification (file store only)
- **chat**: messages appended, model invoked, tool calls executed
- **persist**: save session state at checkpoints via `SessionStore.saveSession()`
- **release**: unlock on exit

## Active session

Each store tracks an active session ID — the most recently used session. Resume without arguments loads the active session, falling back to the most recently updated.

## Storage

Two backends, selected via the `postgresSessions` feature flag (default: file):

- **File** (default): `~/.acolyte/sessions.json`, entire state read/written as JSON
- **Postgres** (feature-flagged): configured via `postgresUrl`, messages stored as JSONB, sessions table with `updated_at` index

The `SessionStore` interface provides granular operations (`listSessions`, `getSession`, `saveSession`, `removeSession`, active session tracking).

## Session vs task

- a session persists across requests — it's the conversation
- a task is a single request execution within a session
- one session can have many tasks over its lifetime

## Extension seams

- swap storage backend via `SessionStore` interface (file, Postgres, or custom)
- session locking is file-store-specific; Postgres handles concurrency natively

## Key files

- `src/session-contract.ts` — session types, schemas, and `SessionStore` interface
- `src/session-store.ts` — file-based session store and store factory
- `src/session-store-postgres.ts` — Postgres session store (feature-flagged)
- `src/session-lock.ts` — PID-based file locking for concurrent access

## Further reading

- [How It Works](https://crisu.me/blog/how-it-works) — daemon architecture and task flow
