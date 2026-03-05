# Architecture

System map of Acolyte runtime flow, boundaries, and extension seams.

Concept pages:
- [lifecycle.md](./lifecycle.md)
- [memory.md](./memory.md)
- [tooling.md](./tooling.md)
- [modes.md](./modes.md)
- [sessions-tasks.md](./sessions-tasks.md)

## System flow

```text
CLI -> client -> server -> lifecycle -> model + tools
```

- **execution model:** one active task per session, with ordered queued tasks.
- **yielding:** lifecycle only yields at safe checkpoints (never mid-step).

## Daemon flow

```text
client -> rpc server -> task queue -> lifecycle worker
```

- **rpc server:** accepts requests, exposes task/status streams, and routes to queue/lifecycle.
- **task queue:** enforces ordering, capacity, and cancellation boundaries.
- **lifecycle worker:** executes accepted tasks through lifecycle phases.

## Task flow

```text
accept -> queue -> run -> complete|fail|cancel
```

- **accept:** validate request and assign `task_id`.
- **queue:** hold until runnable under queue policy.
- **run:** execute lifecycle for active task.
- **complete|fail|cancel:** emit terminal state and persist task outcome.

## Tool layering

```text
lifecycle -> guard -> toolkit -> registry
```

- **guard:** pre-execution safety/redundancy checks and post-execution call recording.
- **toolkit:** domain tool definitions with guarded execution (`core-toolkit`, `git-toolkit`).
- **registry:** toolkit registration, permission filtering, and agent-facing tool surface.

## Lifecycle flow

```text
classify -> prepare -> generate -> evaluate -> finalize
```

- **classify:** choose mode and policy.
- **prepare:** build inputs, context, and tools.
- **generate:** run model + tool calls.
- **evaluate:** decide accept/retry/regenerate (bounded).
- **finalize:** persist outputs and emit final response.

- **regeneration:** evaluators may request regeneration, bounded by caps.
- **scheduling:** yield checks happen between lifecycle decisions, never mid-step.
- **task metrics:** evaluator and summary metrics are scoped by `task_id`.

## Memory Engine

```text
Memory Engine
  -> Memory Pipeline (ingest -> normalize -> select -> inject -> commit)
  -> Memory context in system prompt
```

- **overview:** Memory Engine composes source strategy, pipeline stages, and distill behavior to provide continuity across turns.
- **source strategy:** configured source IDs and order (`memorySources`) determine source composition.
- **pipeline seams:** normalization and selection are strategy-injectable behind registry contracts.
- **selection default:** only the freshest continuation cue is kept and prioritized before other entries.
- **integration:** memory context is injected during request setup; commit is best-effort background work at finalize.
- **canonical details:** see [memory.md](./memory.md).

## Contracts

- **error handling:** tools emit failures/error codes; lifecycle owns retry/regeneration policy.
- **guarding:** guards run before tool execution, can block calls, and are reported through lifecycle events.
- **protocol:** transport contract is transport-agnostic; see `docs/protocol.md`.

## Observability and state

- **observability:** lifecycle emits ordered debug events per request (calls, tool results, evaluator decisions, summaries, errors).
- **runtime config:** loaded from user/project config.
- **state ownership:** chat/session state and memory are persisted outside lifecycle and passed in as inputs.
- **task trace:** RPC emits task-state transitions with stable `task_id`:
```text
accepted -> queued -> running -> completed|failed|cancelled
```
