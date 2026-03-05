# Lifecycle

Lifecycle executes one request through a bounded phase loop:

```text
classify -> prepare -> generate -> evaluate -> finalize
```

## Phase contracts

- **classify**: resolve mode/policy from request intent.
- **prepare**: build agent input, tools, session context, and policy state.
- **generate**: run model + tool loop for one attempt.
- **evaluate**: apply evaluators; choose `done` or bounded regeneration.
- **finalize**: emit final response and lifecycle summary events.

## Regeneration model

- Evaluators can request regeneration.
- Regeneration is bounded by lifecycle policy caps.
- Yield checks only occur at safe checkpoints between lifecycle decisions.

## Memory integration point

- Memory injection happens during request setup before generation.
- Memory commit is scheduled as best-effort background work at finalize.
- Commit failures are logged via lifecycle debug events and do not fail the user response.

## Key files

- `src/lifecycle.ts`
- `src/lifecycle-*.ts`
- `src/lifecycle-evaluators.ts`
