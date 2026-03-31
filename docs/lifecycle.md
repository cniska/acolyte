# Lifecycle

Lifecycle executes one request through a single-pass phase sequence:

```text
resolve → prepare → generate → finalize
```

## Phase contracts

- **resolve**: pick model and policy
- **prepare**: build base agent input, tools, session context, and policy state
- **generate**: run model + tool loop; effects (format, lint) apply per-tool-result via callback; the model may emit a lifecycle signal (`done`, `no_op`, `blocked`) alongside its final text
- **finalize**: accept lifecycle signal, emit final response and summary events; a `blocked` signal maps to `ChatResponseState = "awaiting-input"`

## Single-pass execution

One generation pass runs, effects apply inline during tool execution, and the lifecycle completes. There is no regeneration loop, no feedback injection, and no retry logic at the lifecycle level.

## Effects

- effects are lifecycle-owned side effects applied per-tool-result via the `onToolResult` callback on the session
- the lifecycle configures the callback during context creation; tool execution calls it after each successful tool
- format runs silently; lint errors are appended to the tool result so the model can see and act on them
- current effects are driven by detected workspace commands (format, lint)

## Step budget

- `checkStepBudget()` is inlined into tool execution and enforces per-cycle and total tool-call limits
- when the budget is exhausted, the tool call is blocked with a `budgetExhausted` error code
- this is the only pre-tool policy check; there is no guard abstraction

## Memory integration point

- memory injection happens during request setup before generation
- memory commit is scheduled as best-effort background work at finalize
- commit failures are logged via lifecycle debug events and do not fail the user response

## Key files

- `src/lifecycle.ts` — main orchestrator that coordinates all phases
- `src/lifecycle-constants.ts` — configuration constants for step limits, timeouts, and thresholds
- `src/lifecycle-contract.ts` — type definitions for lifecycle events, inputs, and runtime contexts
- `src/lifecycle-effects.ts` — lifecycle-owned effects (format, lint) applied per-tool-result via callback
- `src/lifecycle-finalize.ts` — finalization phase including token accounting and tool statistics
- `src/lifecycle-generate.ts` — generation phase with agent creation and yield detection
- `src/lifecycle-policy.ts` — lifecycle policy configuration and constraints
- `src/lifecycle-prepare.ts` — preparation phase including input validation and token estimation
- `src/lifecycle-resolve.ts` — initial model resolution for the request
- `src/lifecycle-signal.ts` — extraction and parsing of agent signals from output
- `src/lifecycle-state.ts` — signal acceptance and state validation
- `src/lifecycle-usage.ts` — token usage tracking and prompt breakdown totals
- `src/workspace-profile.ts` — workspace profile types, caching, and instruction generation
- `src/workspace-detectors.ts` — ecosystem detectors for TypeScript, Python, Go, Rust
