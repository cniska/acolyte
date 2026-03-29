# Lifecycle

Lifecycle executes one request through a bounded phase loop:

```text
resolve → prepare → generate → evaluate → finalize
```

## Phase contracts

- **resolve**: pick mode and policy from request intent
- **prepare**: build base agent input, tools, session context, and policy state
- **generate**: run model + tool loop for one attempt; the model may also emit a lifecycle signal (`done`, `no_op`, `blocked`) alongside its final text
- **evaluate**: accept a valid lifecycle signal, run lifecycle-owned commands, then apply pure evaluators and choose `done` or bounded regeneration
- **finalize**: emit final response and lifecycle summary events; a `blocked` signal maps to `ChatResponseState = "awaiting-input"`, signaling the TUI to show a waiting indicator until the user replies

## Regeneration model

- lifecycle commands and evaluators can request regeneration
- regeneration uses task-scoped `lifecycleState` to carry internal feedback and review outcome between attempts
- generation input is rebuilt from immutable base input plus pending mode-scoped lifecycle feedback
- selected guard blocks may also be translated into lifecycle feedback before the next attempt
- a valid lifecycle signal can end the loop cleanly before recovery logic reopens the turn
- regeneration is bounded by lifecycle policy caps
- yield checks only occur at safe checkpoints between lifecycle decisions

## Lifecycle commands

- lifecycle commands own automatic side effects initiated by the lifecycle rather than the model
- they run after signal acceptance and before pure evaluators
- current examples include format and lint checks driven by detected workspace commands
- commands may request regeneration directly and attach lifecycle feedback when the side effect exposes actionable runtime guidance

## Lifecycle state

- `lifecycleState` is internal, task-scoped runtime state owned by the lifecycle
- it currently carries:
  - `feedback`: pending runtime feedback consumed by the next matching-mode attempt
  - `verifyOutcome`: structured review result used across `keepResult` restore boundaries
  - `repeatedFailure`: task-scoped failure streak state used to surface one recovery nudge per repeated failure signature
- lifecycle may also accept a task-scoped lifecycle signal from generation when current runtime state has no contradiction
- lifecycle may translate selected guard blocks into feedback, so the next attempt can recover with clearer runtime context
- `lifecycleState` is not persisted to session history or memory sources
- `lifecycleState` supports the model with concrete runtime outcomes; it does not plan tasks or decide how issues should be resolved

## Memory integration point

- memory injection happens during request setup before generation
- memory commit is scheduled as best-effort background work at finalize
- commit failures are logged via lifecycle debug events and do not fail the user response

## Tool recovery

- `ToolRecovery` is a tool-owned contract for stable failure recovery
- lifecycle consumes it generically; it does not hardcode tool-specific retry policy
- recovery may include optional next-step hints like a suggested next tool or target paths when the tool can state them concretely
- recovery may also declare which successful follow-up tool result resolves the failure, so lifecycle can clear it without tool-specific heuristics

## Key files

- `src/lifecycle.ts` — Main orchestrator that coordinates all phases.
- `src/lifecycle-constants.ts` — Configuration constants for step limits, timeouts, and thresholds.
- `src/lifecycle-contract.ts` — Type definitions for lifecycle events, inputs, and runtime contexts.
- `src/lifecycle-commands.ts` — Lifecycle-owned command runners such as format and lint.
- `src/lifecycle-evaluate.ts` — Evaluation phase orchestration across command execution, recovery, and verification.
- `src/lifecycle-evaluators.ts` — Pure post-generation evaluators including tool recovery.
- `src/lifecycle-finalize.ts` — Finalization phase including token accounting and tool statistics.
- `src/lifecycle-generate.ts` — Generation phase with agent creation and yield detection.
- `src/lifecycle-guard-feedback.ts` — Guard-event-to-feedback translation.
- `src/lifecycle-policy.ts` — Lifecycle policy configuration and constraints.
- `src/lifecycle-prepare.ts` — Preparation phase including input validation and token estimation.
- `src/lifecycle-resolve.ts` — Initial mode and model selection for the request.
- `src/lifecycle-signal.ts` — Extraction and parsing of agent signals from output.
- `src/lifecycle-state.ts` — State validation and transitions through the lifecycle.
- `src/workspace-profile.ts` — Workspace profile types, caching, and instruction generation.
- `src/workspace-detectors.ts` — Ecosystem detectors for TypeScript, Python, Go, Rust.
- `src/lifecycle-usage.ts` — Token usage tracking and prompt breakdown totals.
- `src/tool-recovery.ts` — Tool recovery contract carried from tool errors into evaluators.
