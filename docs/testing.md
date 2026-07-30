# Testing

Acolyte separates pure unit tests, wired integration tests, stable TUI snapshots, and performance baselines so each failure has a clear boundary.

## Test types

- unit: pure logic and contracts (parsing, effects, schemas)
- integration: real server/lifecycle/tool wiring with fake provider model calls
- visual: stable TUI rendering and interaction snapshots
- performance: trend detection for latency regressions, not correctness

## Unit test boundary

- `*.test.ts` and `*.test.tsx` should avoid filesystem writes, subprocesses, and network calls.
- if a test needs real fs/process/network behavior, use `*.int.test.ts` instead.
- prefer mocks for UI/layout-focused unit tests.

## TUI unit testing

- Headless input logic (keystroke → edit action → callbacks) is unit-tested in two layers. Keyboard policy is pure and tested directly in `prompt-keymap`'s own tests: which chord a key means, and which edit that chord implies for a given buffer, including the guards that decide an edit is a no-op. The handler test covers only what the stateful shim owns — meta-prefix timing, state that outlives a render, and a suppressed edit emitting nothing — by rendering it under a fake `InputContext` that captures the registered handler and driving it with synthetic `KeyEvent`s. Byte-level key parsing stays in `tui/input`'s tests, so neither layer asserts escape sequences.
- Layout parity between two render paths (the live tail vs. scrollback, or chat vs. CLI) is pinned by rendering both from one scene and asserting byte-equality, so a forked renderer cannot pass silently.

## Integration test boundary

- Tool integration tests must dispatch through `toolsForAgent({ workspace })` and call `tools.<name>.execute()`, not the underlying function directly. This exercises budget checks, hooks, caching, and call logging — the same path production uses.
- effect integration tests must wire handlers via `attachLifecycleEffectHandlers(ctx, session)` and verify behavior through debug events, not call `effect.run()` directly.
- Direct function calls (e.g., `editFile()`, `runShellCommand()`) belong in unit tests when testing the function contract itself. Integration tests test wiring.

## Test suites

`*.test-suite.ts` files define reusable assertions for store interfaces. They export a function that an `*.int.test.ts` file calls with a specific backend, so the same contract runs against every implementation.

## Commands

- full baseline: `bun run verify`
- all tests: `bun test`
- unit only: `bun run test:unit`
- integration only: `bun run test:int`
- visual only: `bun run test:tui`
- perf baseline: `bun run test:perf`
- coverage report (unit tests only): `bun run test:coverage`

## Perf policy

- keep scenarios deterministic and free (fake provider only)
- use multiple runs and compare median/p95 over time
- fail on meaningful regressions with a median threshold
- add scenarios only when they represent a real user-critical path

## CI perf artifact

- CI uploads `perf-baseline.json` as the `perf-baseline` artifact
- read `scenarios.<id>.summary.medianMs` as the primary regression signal
- use `p95Ms` to detect tail-latency regressions that median may hide
- use `scenarios.<id>.runs` for per-run debugging and outlier checks
