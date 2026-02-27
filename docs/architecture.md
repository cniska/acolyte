# Architecture

## Mental model

Acolyte is a layered coding assistant:

`CLI -> client -> server -> lifecycle -> model + tools`

The lifecycle is the orchestrator. It decides how a request runs, what mode it is in, when to retry, and when to verify.

## Stable boundaries

- Lifecycle: request orchestration and policy
- Agent layer: input/output shaping and instruction assembly
- Mode layer: mode definitions and transitions
- Tool layer: tool wiring and concrete tool implementations
- Guard layer: protection against unsafe or repetitive behavior

## Lifecycle contract

Each request follows the same high-level flow:

1. Classify mode
2. Prepare context/tools
3. Generate with tool calls
4. Evaluate result
5. Finalize response

Evaluators can request a regeneration, but caps prevent runaway loops.

## Error handling contract

Error policy lives in lifecycle, not in individual tools.

- Tools emit plain failures and (when needed) stable machine-readable error codes.
- Lifecycle classifies and records errors, drives retries/regeneration, and emits debug signals.
- Guards block unsafe/repetitive behavior early and are also reported through lifecycle debug events.

This keeps behavior resilient while keeping policy in one place.

## Observability

Lifecycle emits ordered debug events for every request (calls, results, evaluator decisions, summaries, errors).
The trace scripts consume these events so behavior can be inspected after dogfood runs without adding ad-hoc logs.

## Configuration and state

- Runtime config comes from user/project config.
- Chat/session state and memory are persisted outside lifecycle; lifecycle consumes them as inputs.
