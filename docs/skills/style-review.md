---
name: style-review
description: Review code style, naming, patterns, and consistency. Use when reviewing code quality or style drift.
---

# Style Review

Review naming, coding patterns, and style consistency against the codebase's existing conventions.

## Scope

### 1. Naming and shape consistency

- naming consistency across types, constants, functions, and files
- renamed concepts stay aligned across code, tests, docs, and exported identifiers
- constructor and factory naming follows a single project convention
- module and file layout follows the established project structure
- import/export patterns are consistent across the codebase

### 2. Control flow and state modeling

- exhaustive handling of state variants where applicable
- consistent assertion and error patterns
- prefer explicit status/state fields over boolean flags for state transitions
- prefer guard clauses and early returns over deep nesting
- prefer data-driven lookups over long control-flow chains

### 3. Pattern consistency

Check where the codebase already has a clear local pattern:

- structural patterns (table-driven, rule-driven) where nearby code uses them
- error classification follows the project's established convention
- repeated argument groups that want one named type
- raw strings or magic values that should become typed constants
- sibling concepts with different intent should not collapse into one ambiguous shape or name

### 4. Readability and hygiene

- no banner or separator comments
- no unused params, dead branches, or ad-hoc fallbacks
- keep style aligned with nearby code
- abstractions must earn their complexity — if a wrapper adds no value, inline it
- avoid nested ternaries for branching logic; use explicit conditionals, maps, or helpers when multiple cases affect readability
- prefer clarity over cleverness: dense one-liners that require a mental pause should be simplified

## Evidence threshold

Sections 1 and 3 require evidence of a local convention — cite the nearby code that establishes it. Sections 2 and 4 are default checks that apply without repo evidence, but cap them at **Consider** unless a documented convention elevates them. Never report a default check as must-fix.

## Workflow

1. Identify local style conventions from nearby code.
2. Compare against repo-wide documented conventions.
3. Find concrete deviations with evidence.
4. Report findings ordered by severity.

## Output

For each finding: **label** (Critical / Fix / Consider / Nit — see `review`), **file**, **violated convention**, **evidence** (cite both the offending line and the code that establishes the convention), **fix direction**.

- Bad: "`getUserData` — inconsistent, should be `fetchUserData`." (no evidence)
- Good: **Fix** — `src/api/user.ts:12` `getUserData` breaks the fetch-prefix convention (9 of 10 siblings in `src/api/` use `fetch*`). Rename to `fetchUserData`.

Order Critical → Fix → Consider → Nit. If nothing clears the threshold, report "No style findings" — don't pad.

## Red flags

- Enforcing generic style dogma over local conventions
- Broad rewrites instead of minimal fixes
- Speculative abstractions
- Nitpicking formatting not tied to repo conventions
