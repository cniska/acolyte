# Sessions and Tasks

Sessions and tasks are separate runtime concerns.

## Session model

- Session tracks chat context and message history.
- One active task runs at a time per session.
- Session state persists outside lifecycle and is passed in per request.

## Task model

Task lifecycle:

```text
accepted →queued →running →completed|failed|cancelled
```

- **accepted**: request validated and assigned `task_id`.
- **queued**: waiting under queue policy.
- **running**: actively executing lifecycle.
- **terminal**: completed, failed, or cancelled.

## Queue model

- Queue policy enforces ordering and capacity.
- RPC layer exposes queue and task status updates.
- Task transitions are validated and logged with transition reason.

## Key files

- `src/task-contract.ts`
- `src/task-registry.ts`
- `src/rpc-queue.ts`
- `src/server-rpc.ts`
