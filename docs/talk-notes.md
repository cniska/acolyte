# Talk Notes

Presentation-oriented summary points for explaining Acolyte.

## Project Summary

- Personal AI coding delegate for bounded software tasks.
- CLI-first workflow with tool-backed execution, verification loops, and persistent memory.
- Built via dogfooding and iterative hardening rather than big upfront architecture.

## Why It Matters

- Most coding assistants are great at suggestions but weak at reliable execution loops.
- Acolyte focuses on delegated execution: do the work, verify, recover, and explain.
- The goal is not just code generation, but trustworthy autonomous progress in real repos.

## Key Talking Points

- The bottleneck is model reliability under chained tool use, not missing scaffolding.
- Governance matters: clear behavioral contracts and repo instructions materially improve outcomes.
- Building with AI and dogfooding continuously exposes real failure modes faster than synthetic tests.

## Differentiation

- Behavior is managed as explicit policy, not fragile prompt-only tricks.
- Verification as default behavior, not optional advice.
- Streaming + traces make failures diagnosable after real runs.
- Memory that is explicit, scoped, and user-correctable.
- Transport-ready architecture: HTTP baseline plus RPC for two-way control (queueing, cancellation, fast handoff).

## Demo Flow (Short)

1. Show a bounded coding task in a real repo.
2. Show live tool streaming (read/edit/verify/recover).
3. Show final verification and result summary.
4. Show trace-based diagnosis of one failure/retry.
5. Show memory add/inspect to demonstrate continuity.

## Risks and Constraints

- Model quality still sets the ceiling for long autonomous runs.
- Memory quality is only as good as retrieval/promotion heuristics.
- More power needs stronger defaults (guards, permissions, verification gates).

## Lessons Learned

- Reliability beats novelty. A verify-first loop with small scoped changes outperforms bigger "smart" steps.
- Keep policy centralized. Execution policy should be owned in one place; tools should stay execution-focused.
- Use stable machine-readable signals between layers. String-only matching is brittle and expensive over time.
- Errors are first-class behavior. Treat failure paths as normal paths with explicit observability, not edge cases.
- Streaming correctness matters more than polish. Design for streaming semantics early.
- Observability is mandatory for agent quality. Ordered lifecycle traces make dogfooding actionable instead of anecdotal.
- Guardrails improve autonomy. Session-level checks reduce loops and unsafe actions without human intervention.
- Boundaries keep autonomy safe. Task-scoped verification prevents cross-task drift while preserving opt-in global review when needed.
- Prompt/tool-contract quality often beats extra host-side heuristics for everyday coding tasks.
- Dogfooding reveals architecture gaps that unit tests miss, especially around recovery behavior.
- Benchmarking adjacent projects is high leverage: borrow proven patterns, validate tradeoffs, and keep product differentiation intentional.
- Start single-agent and prove reliability before adding multi-agent complexity.
- Keep instructions language-agnostic; avoid overfitting behavior to one stack or toolchain.
- Keep docs conceptual and short. Implementation-detail docs drift quickly and become misleading.
- Visual TUI regression tests are worth the investment; they lock layout quality while enabling fast iteration.
