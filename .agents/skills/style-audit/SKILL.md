---
name: style-audit
description: Audit code style and consistency including naming, patterns, assertions, switch defaults, and module structure. Use when reviewing code quality, coding patterns, or style drift.
---

# Style Audit

Use this skill when asked to review code quality consistency, coding patterns, or style drift.

## Scope

Focus on:
- naming consistency (types, constants, functions, files)
- factory naming consistency (`create*` for factory functions; avoid `build*`/`make*` for factories)
- switch exhaustiveness (`default` + `unreachable` when applicable)
- assert patterns (`invariant` for impossible states vs user-facing errors)
- state modeling clarity: prefer explicit status/state fields over ambiguous boolean flags when values represent lifecycle or workflow phases
- table-driven/rule-driven structure where the codebase already uses it
- dispatch shape: prefer data-driven lookups/tables over long control-flow chains where behavior is mapping-like
- control flow shape: prefer guard clauses and early returns over nested `if/else` chains
- no banner or separator comments; let code structure speak for itself
- avoiding local anti-patterns (unused params, dead branches, ad-hoc fallbacks)
- error classification consistency: prefer structured `kind` contracts over message regex heuristics
- module layout consistency (flat `src/`, `*-contract`, `*-http`, `*-rpc`, no unnecessary re-export layers)
- export shape consistency: prefer direct `export const` declarations over local alias + `export { ... }` wrappers
- import clarity: avoid aliasing imports unless it resolves a real collision or boundary distinction

## References

Read first:
- `AGENTS.md`
- `docs/architecture.md`

Then inspect relevant files for the feature under review.

## Audit Workflow

1. Identify the active local style/pattern conventions from nearby code.
2. Find concrete deviations.
3. Report findings ordered by severity:
   - correctness-affecting style issues
   - maintainability/consistency drift
   - readability polish
4. For each finding include:
   - file reference
   - violated local convention
   - minimal fix direction

## Output Format

- Findings first, ordered by severity.
- For each finding include:
  - file reference
  - violated local convention
  - minimal fix direction
- Then list:
  - must-fix items
  - optional polish

## Anti-Patterns

- Enforcing generic style-guide dogma over local conventions.
- Broad rewrites over minimal diffs.
- Speculative abstractions.
- Boolean flags that hide richer state transitions better modeled as explicit status enums/unions.
- Message-text parsing as primary control flow when a typed contract can be enforced.
