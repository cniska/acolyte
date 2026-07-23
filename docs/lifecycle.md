# Lifecycle

Acolyte executes each request through four explicit phases, with tool effects, native completion, and budget checks applied inside a single generation loop.

```text
resolve → prepare → generate → finalize
```

## Phase contracts

- **resolve**: pick model and policy
- **prepare**: build base agent input, tools, session context, and policy state
- **generate**: run model + tool loop; effects (format, lint) apply per-tool-result via callback; the model terminates with a native `end_turn` (a step with no tool calls), and that step's text is the final response
- **finalize**: accept the terminal step, emit final response and summary events

## Terminal-step classification

The model completes by emitting a no-tool-call step whose text is the final response. Before finalizing, `lifecycle-completion.ts` classifies that step by its provider `finishReason` and answer text:

- **accept** — a normal finish (`stop`, or any unrecognized reason) with text: finalize.
- **incomplete** — the turn never finished: blank text (`empty-answer`) or a `length` cutoff (`truncated`). Reopen once with a model-facing nudge; each reason gets its own single reopen, and a second occurrence errors.
- **failed** — retrying cannot help: `content-filter` or a provider `error`. Error immediately.

`length` is classified before the blank check, since a length cutoff can leave the text empty when the token budget went to reasoning. A truncated continuation appends to the prior fragment so the assembled answer is whole. On any error verdict the host synthesizes the user-facing message (the model's last step cannot be the answer) and still surfaces any partial text alongside the error row.

## Effects

- effects are lifecycle-owned side effects applied per-tool-result via the `onToolResult` callback on the session
- the lifecycle configures the callback during context creation; tool execution calls it after each successful tool
- format runs silently; lint errors are appended to the tool result so the model can see and act on them
- current effects are driven by detected workspace commands (format, lint)

## Tool-call budget

- `checkStepBudget()` is inlined into tool execution and enforces one per-turn tool-call ceiling (`MAX_TOOL_CALLS_PER_REQUEST`, default 300); the count is the length of the request's `callLog`, which resets each turn because `SessionContext` is built fresh per request
- the bound is per-turn by design: a runaway loop lives inside a single generation (the model + tool loop of one request); tool calls across independent, human-gated turns don't correlate, so summing them session-wide would measure productivity, not runaway risk
- a no-tool-call step ends the turn and is never counted, so the model can always terminate
- when the limit is reached, the tool call is blocked with a `budgetExhausted` error code and a neutral message (`Request tool-call limit reached (N).`)
- one neutral notice is injected via `onBeforeNextCall` the first time the count crosses `ceil(BUDGET_NOTICE_FRACTION * limit)` (90%), deduped by a per-request flag: data plus factual consequence, no imperatives
- this is the only pre-tool policy check; there is no guard abstraction

## Per-call input budget

- before each model call, `agent-stream.ts` estimates the composed prompt size (system + messages + tools) and compares it against `preCallInputTokenLimit`, set from `policy.contextMaxTokens`
- `contextMaxTokens` is a flat `MAX_CONTEXT_INPUT_TOKENS` (170k) for every model, not derived per model: the smallest mainstream window (200k, shared input and output) minus output headroom; the low fixed ceiling is deliberate because Acolyte leans on memory rather than a large context window
- the check is exact only for models whose input cap is at least 200k, where 170k always fits; for smaller models (e.g. gpt-4o, local models) it is best-effort and the provider is the real enforcer, so an over-limit prompt there surfaces as a raw provider error rather than `E_BUDGET_EXHAUSTED`
- overflow throws `E_BUDGET_EXHAUSTED` with a composition breakdown (system, tools, messages tokens)
- sessions are bounded by context pressure per call, not by cumulative tokens across calls
- prior tool results persist verbatim across steps within a turn; each result is capped individually via `truncateMiddle(raw, MAX_TOOL_RESULT_CHARS)` at write time, and the per-call budget check above is the backstop for cumulative growth

## Run control

- `RunControl` is a first-class abstraction that owns yield and cancellation behavior for a lifecycle run
- created at the transport layer (e.g. RPC) where queue and abort state are known, and threaded into the lifecycle as a single object
- `shouldYield()` is checked after generation completes and before accepting the result; yielding skips result acceptance and memory commit
- `isCancelled()` is checked at event emission boundaries, in error handlers, and before accepting the result; a cancelled run skips result acceptance and memory commit, so an undelivered answer never reaches history or memory
- both methods are polled (not event-driven) — the answer can change over time as external state evolves

## Memory integration point

- memory injection happens during request setup before generation
- memory commit is scheduled as best-effort background work at finalize
- commit failures are logged via lifecycle debug events and do not fail the user response

## Key files

- `src/lifecycle.ts` — main orchestrator that coordinates all phases, including terminal-step acceptance and state validation
- `src/lifecycle-resolve.ts` — initial model resolution for the request
- `src/lifecycle-prepare.ts` — preparation phase including input validation and token estimation
- `src/lifecycle-generate.ts` — generation phase with agent creation and tool-call loop
- `src/lifecycle-finalize.ts` — finalization phase including token accounting and tool statistics
- `src/lifecycle-contract.ts` — type definitions for lifecycle events, inputs, and runtime contexts
- `src/lifecycle-policy.ts` — lifecycle policy configuration and constraints
- `src/lifecycle-constants.ts` — configuration constants for step limits, timeouts, and thresholds
- `src/lifecycle-effects.ts` — lifecycle-owned effects (format, lint) applied per-tool-result via callback
- `src/lifecycle-usage.ts` — token usage tracking and prompt breakdown totals
- `src/agent-contract.ts` — agent interface, stream types (`StreamChunk`, `GenerateResult`)
- `src/workspace-profile.ts` — workspace profile resolution, caching, and instruction generation
- `src/workspace-contract.ts` — workspace profile and command types
- `src/workspace-detectors.ts` — ecosystem detectors for TypeScript, Python, Go, Rust
