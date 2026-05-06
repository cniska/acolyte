# Lifecycle

Lifecycle executes one request through a single-pass phase sequence:

```text
resolve → prepare → generate → finalize
```

## Phase contracts

- **resolve**: pick model and policy
- **prepare**: build base agent input, tools, session context, and policy state
- **generate**: run model + tool loop; effects (format, lint) apply per-tool-result via callback; the model terminates with a lifecycle signal tool (`signal_done`, `signal_noop`, `signal_blocked`)
- **finalize**: accept lifecycle signal, emit final response and summary events; a `blocked` signal maps to `ChatResponseState = "awaiting-input"`

## Generation loop feedback

Generation owns one model/tool loop. Effects apply inline during tool execution. Before the model is allowed to finalize, lifecycle feedback may inject one extra user message when hard evidence contradicts completion:

- unresolved tool errors are sent back once so the model can inspect evidence and retry instead of falsely finalizing
- missing post-write validation is sent back once so the model can run focused validation or explicitly block

If the model still cannot recover, finalize returns an awaiting-input response with the unresolved error.

## Effects

- effects are lifecycle-owned side effects applied per-tool-result via the `onToolResult` callback on the session
- the lifecycle configures the callback during context creation; tool execution calls it after each successful tool
- format runs silently; lint errors are appended to the tool result so the model can see and act on them
- current effects are driven by detected workspace commands (format, lint)

## Step budget

- `checkStepBudget()` is inlined into tool execution and enforces per-turn and total tool-call limits
- when the budget is exhausted, the tool call is blocked with a `budgetExhausted` error code
- lifecycle signal tools skip the step counter so the model can still terminate after using the available ordinary tool-call budget
- this is the only pre-tool policy check; there is no guard abstraction

## Per-call input budget

- before each model call, `agent-stream.ts` estimates the composed prompt size (system + messages + tools) and compares it against `SessionFlags.preCallInputTokenLimit` (defaulted from `MAX_CONTEXT_TOKENS`)
- overflow throws `E_BUDGET_EXHAUSTED` with a composition breakdown (system, tools, messages tokens)
- sessions are bounded by context pressure per call, not by cumulative tokens across calls; microcompaction keeps prior iterations lean

## Microcompaction

- between model calls, prior tool results in the message history are replaced with a short marker so they stop consuming input tokens on re-send
- `file-read` results are preserved intact so the model can still reference file contents when producing later edits
- implemented in `compactPriorToolResults()` in `agent-stream.ts`

## Run control

- `RunControl` is a first-class abstraction that owns yield and cancellation behavior for a lifecycle run
- created at the transport layer (e.g. RPC) where queue and abort state are known, and threaded into the lifecycle as a single object
- `shouldYield()` is checked after generation completes and before accepting the result; yielding skips result acceptance and memory commit
- `isCancelled()` is checked at event emission boundaries and in error handlers
- both methods are polled (not event-driven) — the answer can change over time as external state evolves

## Memory integration point

- memory injection happens during request setup before generation
- memory commit is scheduled as best-effort background work at finalize
- commit failures are logged via lifecycle debug events and do not fail the user response

## Key files

- `src/lifecycle.ts` — main orchestrator that coordinates all phases, including signal acceptance and state validation
- `src/lifecycle-resolve.ts` — initial model resolution for the request
- `src/lifecycle-prepare.ts` — preparation phase including input validation and token estimation
- `src/lifecycle-generate.ts` — generation phase with agent creation and tool-call loop
- `src/signal-toolkit.ts` — lifecycle signal tools exposed to the model
- `src/lifecycle-finalize.ts` — finalization phase including token accounting and tool statistics
- `src/lifecycle-contract.ts` — type definitions for lifecycle events, inputs, and runtime contexts
- `src/lifecycle-policy.ts` — lifecycle policy configuration and constraints
- `src/lifecycle-constants.ts` — configuration constants for step limits, timeouts, and thresholds
- `src/lifecycle-effects.ts` — lifecycle-owned effects (format, lint) applied per-tool-result via callback
- `src/lifecycle-usage.ts` — token usage tracking and prompt breakdown totals
- `src/agent-contract.ts` — agent interface, stream types (`StreamChunk`, `GenerateResult`, `LifecycleSignal`)
- `src/workspace-profile.ts` — workspace profile resolution, caching, and instruction generation
- `src/workspace-contract.ts` — workspace profile and command types
- `src/workspace-detectors.ts` — ecosystem detectors for TypeScript, Python, Go, Rust
