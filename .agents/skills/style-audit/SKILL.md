---
name: style-audit
description: Audit code style and consistency including naming, patterns, assertions, switch defaults, and module structure. Use when reviewing code quality, coding patterns, or style drift.
---

# Style Audit

Use this skill when asked to review code quality consistency, coding patterns, or style drift.

## Scope

Focus on meaningful style and local consistency, not formatting trivia.

### 1. Naming and shape consistency

Check:

- naming consistency across types, constants, functions, and files
- factory naming consistency (`create*` for factory functions; avoid `build*` / `make*` for true factories unless already established locally)
- export shape consistency: prefer direct `export const` declarations over local alias + `export { ... }` wrappers
- import clarity: avoid aliasing imports unless it resolves a real collision or boundary distinction
- module layout consistency (flat `src/`, `*-contract`, `*-http`, `*-rpc`, avoid unnecessary re-export layers)

### 2. Control flow and state modeling

Check:

- switch exhaustiveness (`default` + `unreachable` when applicable)
- assert patterns (`invariant` for impossible states vs user-facing errors)
- state modeling clarity: prefer explicit status/state fields over ambiguous boolean flags when values represent lifecycle or workflow phases
- control flow shape: prefer guard clauses and early returns over nested `if/else` chains
- dispatch shape: prefer data-driven lookups or rule tables over long control-flow chains where behavior is mapping-like

### 3. Pattern consistency

Check where the codebase already has a clear local pattern:

- table-driven or rule-driven structure where nearby code already uses it
- error classification consistency: prefer structured `kind` contracts over message regex heuristics
- helper signatures that should become a clearer contract object
- repeated argument or field groups that want one named type or helper
- raw strings, flags, or codes that should become small typed values or schema-backed unions

Treat these as clarity and consistency checks, not excuses to introduce speculative abstraction.

### 4. Readability and hygiene

Check:

- avoid banner or separator comments; let code structure carry the organization
- avoid local anti-patterns such as unused params, dead branches, or ad-hoc fallbacks
- prefer small, clear local structure improvements over broad rewrites
- keep style aligned with nearby code unless there is a strong repo-wide convention that clearly overrides it

## Evidence threshold

Only flag a style issue when there is a clear local convention nearby or a documented repo-wide pattern.

Do not enforce generic style-guide preferences over established repository conventions.

Do not flag a deviation if it clearly improves local clarity and does not create meaningful pattern drift.

Prefer concrete, repo-specific consistency findings over taste-level opinions.

## References

Read first:

- `AGENTS.md`
- `docs/architecture.md`

Then inspect the files relevant to the feature or diff under review. Expand to nearby modules when needed to establish the local convention.

## Audit workflow

1. Identify the active local style and pattern conventions from nearby code.
2. Check whether the implementation matches repo-wide documented conventions.
3. Find concrete deviations with clear evidence.
4. Classify findings as:
   - correctness-affecting style issues
   - maintainability or consistency drift
   - readability polish
5. For each finding include:
   - file reference
   - violated local convention
   - concrete evidence
   - minimal fix direction
6. Prefer minimal fixes that restore consistency without broad rewrites.
7. Distinguish confirmed consistency issues from optional polish.

## Output format

Findings first, ordered by severity. No long preamble.

For each finding include:

- **severity**
- **file reference**
- **violated local convention**
- **concrete evidence**
- **minimal fix direction**

Then include:

- **Must-fix items**
- **Optional polish**
- **Open questions / assumptions** (only if needed)

## Review rules

- Prefer local consistency over generic style dogma.
- Prefer minimal diffs over broad cleanup rewrites.
- Prefer explicit state and typed contracts over boolean or stringly-typed control flow.
- Prefer guard clauses and clear dispatch structures when they match nearby code.
- Treat helper extraction, named types, and schema-backed unions as clarity tools, not automatic abstraction triggers.
- Avoid speculative abstractions.
- Respect intentional local deviations when they improve clarity and do not create drift.

## Anti-patterns

- Enforcing generic style-guide dogma over local conventions
- Broad rewrites instead of minimal consistency fixes
- Speculative abstractions
- Boolean flags that hide richer state transitions better modeled as explicit status enums or unions
- Message-text parsing as primary control flow when a typed contract can be enforced
- Nitpicking formatting or preferences that are not tied to repo conventions