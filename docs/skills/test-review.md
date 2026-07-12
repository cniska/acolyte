---
name: test-review
description: Review test adequacy for changed code — meaningful gaps, quality problems, and unnecessary tests. Use when reviewing whether changed code has adequate tests.
---

# Test Review

Review test adequacy for changed code.

## Scope

### 1. Coverage gaps

- new exported behavior with a plausible failure mode — name the bug a missing test would catch
- new branches or error paths without coverage
- changed behavior that existing tests do not exercise
- renamed concepts or protocol terms without tests that cover the new form and guard the old form if needed

### 2. Edge cases

- boundary conditions (empty inputs, missing files, null/undefined)
- error recovery paths (command not found, parse failures)
- configuration variants the code handles

### 3. Test quality

- tests asserting implementation details instead of behavior (method call sequences break on refactor)
- tests duplicating coverage without distinct scenarios
- fragile tests (timing, ordering, absolute paths)
- using the wrong test type (filesystem/process/network in unit tests) — move those to integration tests
- missing cleanup (temp files, cache state)
- mocking internals instead of testing through the real contract — mock at boundaries only
- test names that don't read as specifications
- tests with more than one reason to fail — assert one behavior each

### 4. Unnecessary tests

- tests covering trivial pass-through or type-only modules
- tests duplicating what the type system guarantees
- tests for code that has since changed

## Evidence threshold

Flag a gap as Must-add or Should-add only if you can name the concrete bug or regression the test would catch. If you can't name the bug, don't flag it. Never demand 100% coverage.

- Low-value (don't flag): `formatLabel()` has no test — trivial pass-through, no failure mode.
- High-value (flag): `parseConfig()` on an empty file returns `undefined` but callers assume an object — untested path crashes startup.

## Output

For each finding: **label** (`Must-add` | `Should-add` | `Optional` | `Remove`), **source file + test file**, **what is untested**, **why it matters** (the concrete bug the test would catch), **fix direction**. When invoked from `review`, map Must-add → Critical/Fix, Should-add → Fix, Optional/Remove → Consider.

Group the summary by those labels. Cap Must-add/Should-add at ~5; fold the rest into one Optional line or omit. If nothing clears the threshold, say "No test findings".

## See also

- `tdd` for implementation-time test discipline
- `review` for multi-axis merge decisions

## Red flags

- Demanding 100% line coverage
- Flagging missing tests for trivial functions
- Suggesting tests that only verify the type system
- Broad test rewrites instead of targeted additions
- Confusing test quantity with quality
