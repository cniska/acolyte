# Tasks

Each Acolyte chat request becomes a tracked task with explicit states, validated transitions, queue policy, cancellation, and observable progress.

## Lifecycle

```text
accepted → queued → running → completed|failed|cancelled
```

Six states total:

| State | Terminal | Description |
|-------|----------|-------------|
| `accepted` | no | request validated, `task_id` assigned |
| `queued` | no | waiting under queue policy |
| `running` | no | actively executing lifecycle |
| `completed` | yes | finished successfully |
| `failed` | yes | encountered an error |
| `cancelled` | yes | aborted by client or connection close |

## Transitions

Valid transitions (anything else is rejected):

```text
accepted  → queued, running, cancelled
queued    → running, cancelled
running   → completed, failed, cancelled
```

Terminal states allow no further transitions. Idempotent transitions (same state → same state) are always valid.

### Transition reasons

| Reason | Trigger | Transition |
|--------|---------|------------|
| `chat_accepted` | RPC `chat.start` received | → `accepted`, then `queued` or `running` |
| `chat_started` | worker begins execution | → `running` |
| `chat_completed` | chat handler finished | → `completed` |
| `chat_failed` | chat handler threw | → `failed` |
| `abort_requested` | client sent `chat.abort` | → `cancelled` |
| `connection_closed` | WebSocket disconnected | all active/queued → `cancelled` |

## Queue model

Per-connection serial execution — one active task at a time, others queue up.

- max 25 queued tasks per connection (`RPC_MAX_QUEUED_TASKS_PER_CONNECTION`)
- FIFO ordering, 1-indexed positions reported to client
- aborted items marked and skipped on dequeue
- position updates broadcast to remaining clients after abort/dequeue
- different connections execute in parallel

## Concurrency

- one `runningChatId` per connection
- `runControl.shouldYield()` checked during lifecycle — allows preemption for queued tasks
- `runControl.isCancelled()` checked at worker start
- global `rpcQueuedTaskCount` for monitoring across all connections

## Storage

- in-memory `TaskStore` (Map-based, not persisted across restarts)
- max 1000 tasks by default, oldest terminal tasks evicted first
- `TaskRecord`: `{ id, state, createdAt, updatedAt }` — immutable, replaced on transition

## Task vs session

- `TaskId` (`task_*`): server-generated, one per chat request execution
- `SessionId` (`sess_*`): client-provided, persists across requests for conversation continuity
- one session can have many tasks over its lifetime

## Key files

- `src/task-contract.ts` — task states, transitions, validation
- `src/task-registry.ts` — task creation, state machine, pruning
- `src/task-store.ts` — in-memory task persistence
- `src/rpc-queue.ts` — per-connection queue with abort and position tracking
- `src/server-rpc.ts` — RPC layer wiring tasks to lifecycle

## Further reading

- [Follow the Thread](https://crisu.me/blog/follow-the-thread) — how the trace tool went from a debugging script to a first-class CLI command
