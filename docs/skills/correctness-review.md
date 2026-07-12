---
name: correctness-review
description: Review whether changed logic does what it claims — bugs, edge cases, broken contracts. Use when reviewing a diff for correctness, not just style or structure.
---

# Correctness Review

Review whether the changed code actually does what it claims — the bugs that pass type-checking and linting but produce wrong results. This is the dimension the others miss: style, boundaries, coverage, and docs can all be clean while the logic is simply wrong.

## Scope

### 1. Logic

- inverted or off-by-one conditions, wrong comparison or boolean operator
- wrong variable, field, or argument order used
- a calculation that produces the wrong result for a valid input

### 2. Edge cases

- unhandled empty, null, zero, negative, or maximum inputs
- a missing early return or default branch — a case the code silently skips
- a boundary where behavior flips (first/last, inclusive/exclusive)

### 3. Control flow and async

- missing `await`, unhandled rejection, or fire-and-forget that should block
- errors swallowed or caught too broadly; a failure path that returns success
- unreachable code, or a branch that can't be entered

### 4. Contract

- the function does not do what its name, signature, or doc claims
- a caller's assumption the change now breaks (return shape, nullability, ordering)
- shared state mutated without guarding a race, or written where callers don't expect it

## Evidence threshold

Flag a bug only with a concrete trigger: name the input or sequence and the wrong result it produces. If you can't state the input that breaks it, it's not a finding — it's a worry. Don't re-flag what an existing test already covers.

## Workflow

1. Read the diff and enough surrounding code to know what each change is *supposed* to do.
2. For each change, ask: what input or interleaving makes this do the wrong thing? Trace actual behavior against claimed behavior.
3. Check the tests — a green suite around wrong behavior means the test is wrong too; note both.
4. For large diffs, work through it area by area; verify each trigger yourself before reporting.

## Output

For each finding: **label** (Critical / Fix / Consider / Nit — see `review`), **file**, **the bug**, **triggering input → wrong result**, **fix direction**.

- Bad: "This function looks fragile and could misbehave." (no trigger)
- Good: **Critical** — `pricing.ts:40` `applyDiscount` uses `>` not `>=`, so an order exactly at the threshold gets nothing (total 100, threshold 100 → 0% instead of 10%).

Order Critical → Fix → Consider → Nit. If nothing breaks under a concrete input, report "No correctness findings" — don't invent worries.

## See also

- `review` for severity framing and merge gating
- `test-review` for whether the bug's absence is guarded by a test
- `debug` for reproducing and root-causing a confirmed bug

## Red flags

- Flagging style, naming, or structure as correctness — that's another dimension
- A finding with no triggering input — speculation, not a bug
- Re-deriving what a passing test already proves, with no new evidence
- "Could theoretically" / "might" with no concrete case
