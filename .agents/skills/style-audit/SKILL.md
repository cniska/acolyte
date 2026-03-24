---
name: style-audit
description: Audit code style, naming, patterns, and consistency.
---

# Style Audit

Review code quality consistency, coding patterns, and style drift.

## Scope

### 1. Naming and shape consistency

- naming consistency across types, constants, functions, and files
- factory naming (`create*` for factories; avoid `build*` / `make*` unless established locally)
- export shape: prefer direct `export const` over local alias + `export { ... }`
- import clarity: avoid aliasing unless it resolves a collision
- module layout consistency (flat `src/`, `*-contract`, avoid re-export layers)

### 2. Control flow and state modeling

- switch exhaustiveness (`default` + `unreachable` when applicable)
- assert patterns (`invariant` for impossible states vs user-facing errors)
- prefer explicit status/state fields over boolean flags for lifecycle phases
- prefer guard clauses and early returns over nested `if/else`
- prefer data-driven lookups over long control-flow chains
- effect discipline: no direct `useEffect` in chat-layer code

### 3. Pattern consistency

Check where the codebase already has a clear local pattern:

- table-driven or rule-driven structure where nearby code uses it
- error classification: prefer `kind` contracts over message regex
- repeated argument groups that want one named type
- raw strings or codes that should become typed values

### 4. Readability and hygiene

- no banner or separator comments
- no unused params, dead branches, or ad-hoc fallbacks
- keep style aligned with nearby code

## Evidence threshold

Only flag issues with a clear local convention or documented repo-wide pattern. Do not enforce generic style-guide preferences.

## Workflow

1. Identify local style conventions from nearby code.
2. Compare against repo-wide documented conventions (`AGENTS.md`, `docs/architecture.md`).
3. Find concrete deviations with evidence.
4. Report findings ordered by severity.

## Output

For each finding: **severity**, **file**, **violated convention**, **evidence**, **fix direction**.

Then: **Must-fix** | **Optional polish** | **Open questions** (if needed).

## Anti-patterns

- Enforcing generic style dogma over local conventions
- Broad rewrites instead of minimal fixes
- Speculative abstractions
- Nitpicking formatting not tied to repo conventions
