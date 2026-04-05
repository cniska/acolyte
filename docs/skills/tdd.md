---
name: tdd
description: Drive implementation with red-green-refactor. Use when building or fixing behavior through tests first.
---

# TDD

Drive implementation through small red-green-refactor loops.

## Scope

Use the smallest test type that gives strong confidence.

- unit: pure logic and contracts
- integration: real wiring with fake external calls
- visual: rendering and interaction snapshots
- performance: trend detection, not correctness

If a test needs real fs/process/network behavior, use integration tests instead of unit tests.

## Workflow

1. Read the relevant code, existing tests, and `docs/testing.md` before writing anything.
2. Pick one behavior slice. Write one test that fails for the right reason.
3. Run the smallest command that proves the test is red.
4. Make the smallest implementation change that turns the test green.
5. Refactor while green. Keep the behavior fixed and the diff small.
6. Repeat one slice at a time.
7. Before stopping, run the narrowest relevant test command again. Before committing, run the full test suite.

## Test selection

- Test through public behavior, not internals. Prefer DAMP (descriptive and meaningful phrases) over DRY in tests — each test should independently communicate what it verifies.
- Prefer extending an existing nearby test file before creating a new one.
- Add integration tests for wiring, I/O, or real process/fs boundaries.
- Do not add tests for trivial pass-through code or type-system guarantees.
- Mock at system boundaries (fs, network, external APIs), not between internal functions. Prefer real implementations when practical.

## Red flags

- Writing multiple tests before the first one passes
- Running all tests by default when a smaller target would do
- Mocking internals instead of testing the real contract
- Refactoring while red
- Broadening scope beyond the current behavior slice
- Stopping at green without a final cleanup pass
