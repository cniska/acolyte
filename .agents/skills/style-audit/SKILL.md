---
name: style-audit
description: Audit code style and consistency rules in Acolyte (naming, patterns, assertions, switch defaults, file/module structure) and suggest minimal fixes.
---

# Style Audit

Use this skill when asked to review code quality consistency, coding patterns, or style drift.

## Scope

Focus on:
- naming consistency (types, constants, functions, files)
- factory naming consistency (`create*` for factory functions; avoid `build*`/`make*` for factories)
- switch exhaustiveness (`default` + `unreachable` when applicable)
- assert patterns (`invariant` for impossible states vs user-facing errors)
- table-driven/rule-driven structure where the codebase already uses it
- dispatch shape: prefer data-driven lookups/tables over long control-flow chains where behavior is mapping-like
- control flow shape: prefer guard clauses and early returns over nested `if/else` chains
- avoiding local anti-patterns (unused params, dead branches, ad-hoc fallbacks)
- module layout consistency (flat `src/`, `*-contract`, `*-http`, `*-rpc`, no unnecessary re-export layers)

## Canonical References

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

- Findings first, ordered by severity
- For each finding include:
- file reference
- violated local convention
- minimal fix direction
- Then list:
- must-fix items
- optional polish

## Guardrails

- Do not enforce generic style-guide dogma over local conventions.
- Prefer minimal diffs over broad rewrites.
- No speculative abstractions.
