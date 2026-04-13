# Testing

Use the smallest test type that gives strong confidence.

## Test types

- unit: pure logic and contracts (parsing, effects, schemas)
- integration: real server/lifecycle/tool wiring with fake provider model calls
- visual: stable TUI rendering and interaction snapshots
- performance: trend detection for latency regressions, not correctness

## Unit test boundary

- `*.test.ts` and `*.test.tsx` should avoid filesystem writes, subprocesses, and network calls.
- If a test needs real fs/process/network behavior, use `*.int.test.ts` instead.
- Prefer mocks for UI/layout-focused unit tests.

## Integration test boundary

- Tool integration tests must dispatch through `toolsForAgent({ workspace })` and call `tools.<name>.execute()`, not the underlying function directly. This exercises budget checks, hooks, caching, and call logging — the same path production uses.
- Effect integration tests must wire handlers via `attachLifecycleEffectHandlers(ctx, session)` and verify behavior through debug events, not call `effect.run()` directly.
- Direct function calls (e.g., `editFile()`, `runShellCommand()`) belong in unit tests when testing the function contract itself. Integration tests test wiring.

## Commands

- Full baseline: `bun run verify`
- All tests: `bun test`
- Unit only: `bun run test:unit`
- Integration only: `bun run test:int`
- Visual only: `bun run test:tui`
- Perf baseline: `bun run test:perf`
- Behavior harness: `bun run behavior:run --model anthropic/claude-sonnet-4-6`
- Coverage report (unit tests only): `bun run test:coverage`

## Behavior harness

- use `scripts/run-behavior.ts` for small real-model tuning tasks across bounded temporary workspaces
- keep scenarios explicit, small, and manually inspectable; this harness is for behavioral comparison, not automatic scoring
- prefer a few stable scenarios over many overlapping ones

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
