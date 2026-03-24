---
name: test-audit
description: Audit test coverage, quality, and missing edge cases. Use when reviewing whether changed code has adequate tests.
---

# Test Audit

Review test adequacy for changed code.

## Scope

### 1. Coverage gaps

- new exported functions or modules without tests
- new branches or error paths without coverage
- changed behavior that existing tests do not exercise

### 2. Edge cases

- boundary conditions (empty inputs, missing files, null/undefined)
- error recovery paths (command not found, parse failures)
- configuration variants the code handles

### 3. Test quality

- tests asserting implementation details instead of behavior
- tests duplicating coverage without distinct scenarios
- fragile tests (timing, ordering, absolute paths)
- missing cleanup (temp files, cache state)

### 4. Unnecessary tests

- tests covering trivial pass-through or type-only modules
- tests duplicating what the type system guarantees
- tests for code that has since changed

## Evidence threshold

Only flag gaps where untested code has meaningful behavior. Do not demand 100% coverage — prioritize tests that catch real bugs.

## Output

For each finding: **severity**, **source file + test file**, **what is untested**, **why it matters**, **fix direction**.

Then: **Must-add** | **Should-add** | **Optional** | **Remove** (if any).

## Anti-patterns

- Demanding 100% line coverage
- Flagging missing tests for trivial functions
- Suggesting tests that only verify the type system
- Broad test rewrites instead of targeted additions
- Confusing test quantity with quality
