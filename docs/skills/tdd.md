---
name: tdd
description: Drive implementation with red-green-refactor.
---

# TDD

Drive implementation through the red-green-refactor cycle.

## Workflow

1. **Understand the behavior**: read enough code to know what the change should do and where it belongs.
2. **Write one failing test**: the test describes the next behavior to add. It must fail for the right reason.
3. **Make it pass**: write the minimum code to pass the test. Nothing more.
4. **Refactor**: clean up while green. Improve naming, remove duplication, simplify structure. Run tests after each change.
5. **Repeat**: pick the next behavior and go back to step 2.

One test at a time. Each cycle is vertical — one test, one implementation, one refactor pass. Do not write multiple tests before implementing.

## What to test

- Observable behavior through public interfaces.
- The contract the caller depends on, not the implementation behind it.
- Error paths that have meaningful recovery or user-facing consequences.
- Prefer DAMP (descriptive and meaningful phrases) over DRY in tests — each test should independently communicate what it verifies.

## What not to test

- Implementation details that can change without affecting behavior.
- Type-system guarantees the compiler already enforces.
- Trivial pass-through or delegation with no logic.

## Mock at boundaries

Mock at system boundaries (database, network, file system, external APIs), not between internal functions. Prefer real implementations when practical. If a test would survive a complete rewrite of the internals, it is testing the right thing.

## Red flags

- Writing all tests first, then all implementation (horizontal slicing)
- Mocking internals instead of testing through public interfaces
- Testing the shape of data instead of behavior
- Adding speculative tests for edge cases that cannot happen
- Refactoring while red
- Skipping the refactor step because tests pass
