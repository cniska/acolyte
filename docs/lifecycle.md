# Lifecycle

Lifecycle executes one request through a single-pass phase sequence:

```text
resolve → prepare → generate → settle → finalize
```

## Phase contracts

- **resolve**: pick model and policy
- **prepare**: build base agent input, tools, session context, and policy state
- **generate**: run model + tool loop; the model may also emit a lifecycle signal (`done`, `no_op`, `blocked`) alongside its final text
- **settle**: accept a valid lifecycle signal, run format/lint effects; lint errors surface in the tool result for the model to decide
- **finalize**: emit final response and lifecycle summary events; a `blocked` signal maps to `ChatResponseState = "awaiting-input"`, signaling the TUI to show a waiting indicator until the user replies

## Single-pass execution

One generation pass runs, effects execute, the signal is accepted, and the lifecycle completes. There is no regeneration loop, no feedback injection, and no retry logic at the lifecycle level.

## Effects

- effects own automatic side effects initiated by the lifecycle rather than the model
- they run during settle after signal acceptance
- current examples include format and lint checks driven by detected workspace commands
- lint errors are surfaced in the tool result for the model to decide on; they do not trigger regeneration

## Step budget

- `checkStepBudget()` is inlined into tool execution and enforces per-cycle and total tool-call limits
- when the budget is exhausted, the tool call is blocked with a `budgetExhausted` error code
- this is the only pre-tool policy check; there is no guard abstraction

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
- `src/lifecycle-effects.ts` — Lifecycle-owned side-effects such as format and lint.
- `src/lifecycle-settle.ts` — Settle phase: signal acceptance and effect execution.
- `src/lifecycle-finalize.ts` — Finalization phase including token accounting and tool statistics.
- `src/lifecycle-generate.ts` — Generation phase with agent creation and yield detection.
- `src/lifecycle-policy.ts` — Lifecycle policy configuration and constraints.
- `src/lifecycle-prepare.ts` — Preparation phase including input validation and token estimation.
- `src/lifecycle-resolve.ts` — Initial model resolution for the request.
- `src/lifecycle-signal.ts` — Extraction and parsing of agent signals from output.
- `src/lifecycle-state.ts` — State validation and transitions through the lifecycle.
- `src/workspace-profile.ts` — Workspace profile types, caching, and instruction generation.
- `src/workspace-detectors.ts` — Ecosystem detectors for TypeScript, Python, Go, Rust.
- `src/lifecycle-usage.ts` — Token usage tracking and prompt breakdown totals.
- `src/tool-recovery.ts` — Tool recovery contract carried from tool errors into the settle phase.
