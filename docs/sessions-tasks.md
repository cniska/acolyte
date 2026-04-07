# Sessions and Tasks

Sessions and tasks are separate runtime concerns.

## Session model

- session tracks chat context and message history
- one active task runs at a time per session
- session state persists outside lifecycle and is passed in per request

## Task model

Task lifecycle:

```text
accepted → queued → running → completed|failed|cancelled
```

- **accepted**: request validated and assigned `task_id`
- **queued**: waiting under queue policy
- **running**: actively executing lifecycle
- **terminal**: completed, failed, or cancelled

## Queue model

- queue policy enforces ordering and capacity
- RPC layer exposes queue and task status updates
- task transitions are validated and logged with transition reason

## Session storage

Two backends, selected via the `postgresSessions` feature flag (default: file):

- **File** (default): `~/.acolyte/sessions.json`, entire state read/written as JSON
- **Postgres** (feature-flagged): configured via `postgresUrl`, messages stored as JSONB, sessions table with `updated_at` index

The `SessionStore` interface provides granular operations (`listSessions`, `getSession`, `saveSession`, `removeSession`, active session tracking).

## Key files

- `src/session-store.ts` — `SessionStore` interface
- `src/storage.ts` — file-based session store and store factory
- `src/session-store-postgres.ts` — Postgres session store (feature-flagged)
- `src/session-contract.ts` — session types and schemas
- `src/task-contract.ts` — task state schema and transition validation
- `src/task-registry.ts` — task state transitions and persistence
- `src/rpc-queue.ts` — request queuing with abort and position tracking
- `src/server-rpc.ts` — RPC server for chat requests and task state management

## Further reading

- [How It Works](https://crisu.me/blog/how-it-works) — daemon architecture and task flow
- [Follow the Thread](https://crisu.me/blog/follow-the-thread) — how the trace tool went from a debugging script to a first-class CLI command
