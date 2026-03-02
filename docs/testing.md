# Testing

Use the smallest test type that gives strong confidence.

## Test types

- Unit: pure logic and contracts (guards, parsing, evaluators, schemas).
- Integration: real server/lifecycle/tool wiring with fake provider model calls.
- Visual: stable TUI rendering and interaction snapshots.
- Performance: trend detection for latency regressions, not correctness.

## Commands

- Full baseline: `bun run verify`
- Integration only: `bun run test:int`
- Visual only: `bun run test:tui`
- Perf baseline: `bun run test:perf`

## Perf policy

- Keep scenarios deterministic and free (fake provider only).
- Use multiple runs and compare median/p95 over time.
- Fail on meaningful regressions with a median threshold.
- Add scenarios only when they represent a real user-critical path.
