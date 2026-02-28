# Architecture

## Mental model (ELI5)

Think of Acolyte like a careful helper with task cards:

- Every user message gets its own task card (with id + state).
- It works on one card at a time using tools.
- New cards can wait in order.
- At safe checkpoints ("yield points"), it can pause the current card and switch to a newer one if needed.
- It leaves clear breadcrumbs so failures are easy to replay and debug.

## System flow

Acolyte is a layered coding assistant:

```text
CLI -> client -> server -> lifecycle -> model + tools
```

The lifecycle is the orchestrator. It decides how a request runs, what mode it is in, when to retry, and when to verify.

## Stable boundaries

- Lifecycle: request orchestration and policy
- Agent layer: input/output shaping and instruction assembly
- Mode layer: mode definitions and transitions
- Tool layer: tool wiring and concrete tool implementations
- Guard layer: protection against unsafe or repetitive behavior
- Protocol layer: transport-agnostic client/server contract (see `docs/protocol.md`)

## Lifecycle contract

Each request follows the same high-level flow:

1. Classify mode
2. Prepare context/tools
3. Generate with tool calls
4. Evaluate result
5. Finalize response

Evaluators can request a regeneration, but caps prevent runaway loops.
Yield checks happen between lifecycle decisions so newer queued work can be picked up without unsafe mid-step interruption.
Evaluator and summary metrics are task-scoped: they use tool history tagged to the active task id.

## Error handling contract

Error policy lives in lifecycle, not in individual tools.

- Tools emit plain failures and (when needed) stable machine-readable error codes.
- Lifecycle classifies and records errors, drives retries/regeneration, and emits debug signals.
- Guards block unsafe/repetitive behavior early and are also reported through lifecycle debug events.

This keeps behavior resilient while keeping policy in one place.

## Observability

Lifecycle emits ordered debug events for every request (calls, results, evaluator decisions, summaries, errors).
RPC task execution also emits explicit task-state transitions (`accepted/queued/running/completed/failed/cancelled`) with a stable `task_id`.
This makes it possible to trace one task end-to-end across queueing, execution, and completion without ad-hoc logging.

## Configuration and state

- Runtime config comes from user/project config.
- Chat/session state and memory are persisted outside lifecycle; lifecycle consumes them as inputs.
