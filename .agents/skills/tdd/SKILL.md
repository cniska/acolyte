---
name: tdd
description: Drive implementation with red-green-refactor. Use when building or fixing behavior through tests first.
---

# TDD

Drive implementation through small red-green-refactor loops.

## Scope

Use the smallest test type that gives strong confidence.

- unit: pure logic and contracts
- integration: real server/lifecycle/tool wiring with fake provider model calls
- visual: stable TUI rendering and interaction snapshots
- performance: trend detection, not correctness

If a test needs real fs/process/network behavior, use `*.int.test.ts` instead of `*.test.ts`.

## Workflow

1. Read the relevant code, existing tests, and `docs/testing.md` before writing anything.
2. Pick one behavior slice. Write one test that fails for the right reason.
3. Run the smallest command that proves the test is red:
   - single file: `bun test <file>`
   - unit suite: `bun run test:unit`
   - integration suite: `bun run test:int`
   - visual suite: `bun run test:tui`
4. Make the smallest implementation change that turns the test green.
5. Refactor while green. Keep the behavior fixed and the diff small.
6. Repeat one slice at a time.
7. Before stopping, run the narrowest relevant test command again. Before committing, run `bun run verify`.

## Acolyte checks

- Fix the implementation when behavior and tests diverge. Update expectations only when explicitly requested.
- Route behavior through canonical seams: `runTool`, evaluators, guards, detectors, and typed contracts.
- New payloads, config, and model-facing data stay validated through Zod.
- Preserve the `@signal` contract when touching lifecycle or model output handling.
- In chat-layer code, use approved effect helpers instead of direct `useEffect`.

## Test selection

- Test through public behavior, not internals.
- Prefer extending an existing nearby test file before creating a new one.
- Add integration tests for lifecycle, tool wiring, RPC flow, or real process/fs boundaries.
- Add visual tests for stable TUI rendering behavior.
- Do not add tests for trivial pass-through code or type-system guarantees.

## Anti-patterns

- Writing multiple tests before the first one passes
- Running `bun test` by default when a smaller target would do
- Mocking internals instead of testing the real contract
- Refactoring while red
- Broadening scope beyond the current behavior slice
- Stopping at green without a final cleanup pass
