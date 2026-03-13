# Lifecycle

Lifecycle executes one request through a bounded phase loop:

```text
resolve →prepare →generate →evaluate →finalize
```

## Phase contracts

- **resolve**: pick mode and policy from request intent.
- **prepare**: build base agent input, tools, session context, and policy state.
- **generate**: run model + tool loop for one attempt.
- **evaluate**: apply evaluators; choose `done` or bounded regeneration.
- **finalize**: emit final response and lifecycle summary events.

## Regeneration model

- Evaluators can request regeneration.
- Regeneration uses task-scoped `lifecycleState` to carry internal feedback and verify outcome between attempts.
- Generation input is rebuilt from immutable base input plus pending mode-scoped lifecycle feedback.
- Regeneration is bounded by lifecycle policy caps.
- Yield checks only occur at safe checkpoints between lifecycle decisions.

## Lifecycle state

- `lifecycleState` is internal, task-scoped runtime state owned by the lifecycle.
- It currently carries:
  - `feedback`: pending runtime feedback consumed by the next matching-mode attempt
  - `verifyOutcome`: structured verifier result used across `keepResult` restore boundaries
- `lifecycleState` is not persisted to session history or memory sources.

## Memory integration point

- Memory injection happens during request setup before generation.
- Memory commit is scheduled as best-effort background work at finalize.
- Commit failures are logged via lifecycle debug events and do not fail the user response.

## Key files

- `src/lifecycle.ts`
- `src/lifecycle-*.ts`
- `src/lifecycle-evaluators.ts`
