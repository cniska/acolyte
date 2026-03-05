# Architecture

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

- **memory pipeline:** unified stage flow for all memory sources.
- **registry:** orchestrates MemorySource loading/commit through the memory pipeline.
- **request gate:** memory is request-controlled. `useMemory=false` disables both memory injection and distill commit (stateless turn).
- **stored:** user-managed explicit memories (read-only at load time).
- **distill:** auto-extracted session knowledge with two tiers:
  - **observation:** facts extracted from a single conversation round.
  - **reflection:** consolidated facts across multiple rounds.
- **distill load strategy:** prefer latest reflection, then append only post-reflection observations (fresh delta).
- **distill commit strategy:** extract from recent transcript plus latest assistant output; reflection runs on post-reflection observation delta once thresholds are crossed.
- **dedupe:** consecutive equivalent observations are skipped to reduce repetitive memory noise.
- **continuation state:** distill records capture `Current task` / `Next step` when present and inject them explicitly into memory context.
- **distill output controls:** observation/reflection outputs are clamped to configured token limits; reflection retries with stronger compression guidance before discard.
- **commit concurrency:** memory commits are serialized per session per process through a keyed task queue seam (default: in-memory implementation).
- **storage:** file-based at `~/.acolyte/distill/<sessionId>/`, Zod-validated on read with safe session-id path checks.
- **storage writes:** distill records use temp-file + rename atomic writes to avoid partial files.
- **integration:** selected memory is injected into the system prompt during request setup; distill commit is scheduled as best-effort background work at lifecycle finalize.

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
