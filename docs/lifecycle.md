# Lifecycle

Lifecycle executes one request through a bounded phase loop:

```text
resolve → prepare → generate → evaluate → finalize
```

## Phase contracts

- **resolve**: pick mode and policy from request intent.
- **prepare**: build base agent input, tools, session context, and policy state.
- **generate**: run model + tool loop for one attempt; the model may also emit a lifecycle signal (`done`, `no_op`, `blocked`) alongside its final text.
- **evaluate**: accept a valid lifecycle signal or apply evaluators and choose `done` or bounded regeneration.
- **finalize**: emit final response and lifecycle summary events.

## Regeneration model

- Evaluators can request regeneration.
- Regeneration uses task-scoped `lifecycleState` to carry internal feedback and verify outcome between attempts.
- Generation input is rebuilt from immutable base input plus pending mode-scoped lifecycle feedback.
- Selected guard blocks may also be translated into lifecycle feedback before the next attempt.
- A valid lifecycle signal can end the loop cleanly before recovery logic reopens the turn.
- Regeneration is bounded by lifecycle policy caps.
- Yield checks only occur at safe checkpoints between lifecycle decisions.

## Lifecycle state

- `lifecycleState` is internal, task-scoped runtime state owned by the lifecycle.
- It currently carries:
  - `feedback`: pending runtime feedback consumed by the next matching-mode attempt
  - `verifyOutcome`: structured verifier result used across `keepResult` restore boundaries
  - `repeatedFailure`: task-scoped failure streak state used to surface one recovery nudge per repeated failure signature
- Lifecycle may also accept a task-scoped lifecycle signal from generation when current runtime state has no contradiction.
- Lifecycle may translate selected guard blocks into feedback, so the next attempt can recover with clearer runtime context.
- `lifecycleState` is not persisted to session history or memory sources.
- `lifecycleState` supports the model with concrete runtime outcomes; it does not plan tasks or decide how issues should be resolved.

## Memory integration point

- Memory injection happens during request setup before generation.
- Memory commit is scheduled as best-effort background work at finalize.
- Commit failures are logged via lifecycle debug events and do not fail the user response.

## Key files

- `src/lifecycle.ts`
- `src/lifecycle-*.ts`
- `src/lifecycle-evaluators.ts` — post-generation evaluators including tool recovery
- `src/lifecycle-guard-feedback.ts` — guard-event-to-feedback translation
- `src/tool-recovery.ts` — `ToolRecovery` contract carried from tool errors into evaluators

## Tool recovery

- `ToolRecovery` is a tool-owned contract for stable failure recovery.
- Lifecycle consumes it generically; it does not hardcode tool-specific retry policy.
- Recovery may include optional next-step hints like a suggested next tool or target paths when the tool can state them concretely.
- Recovery may also declare which successful follow-up tool result resolves the failure, so lifecycle can clear it without tool-specific heuristics.
