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

## Key files

- `src/task-contract.ts` — Task state schema and transition validation.
- `src/task-registry.ts` — Task state transitions and persistence.
- `src/rpc-queue.ts` — Request queuing with abort and position tracking.
- `src/server-rpc.ts` — RPC server for chat requests and task state management.

## Further reading

- [How It Works](https://crisu.me/blog/how-it-works) — Daemon architecture and task flow.
- [Follow the Thread](https://crisu.me/blog/follow-the-thread) — How the trace tool went from a debugging script to a first-class CLI command.
