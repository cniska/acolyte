---
name: style
description: Review code style, naming, patterns, and consistency. Use when reviewing code quality or style drift.
---

# Style

Review code quality consistency, coding patterns, and style drift.

## Scope

### 1. Naming and shape consistency

- naming consistency across types, constants, functions, and files
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

### 4. Readability and hygiene

- no banner or separator comments
- no unused params, dead branches, or ad-hoc fallbacks
- keep style aligned with nearby code
- abstractions must earn their complexity — if a wrapper adds no value, inline it
- no premature file splitting — keep related code in one file until size or complexity justifies separation
- prefer clarity over cleverness: dense one-liners that require a mental pause should be simplified

## Evidence threshold

Only flag issues with a clear local convention or documented repo-wide pattern. Do not enforce generic style-guide preferences.

## Workflow

1. Identify local style conventions from nearby code.
2. Compare against repo-wide documented conventions.
3. Find concrete deviations with evidence.
4. Report findings ordered by severity.

## Output

For each finding: **severity**, **file**, **violated convention**, **evidence**, **fix direction**.

Then: **Must-fix** | **Optional polish** | **Open questions** (if needed).

## Red flags

- Enforcing generic style dogma over local conventions
- Broad rewrites instead of minimal fixes
- Speculative abstractions
- Nitpicking formatting not tied to repo conventions
