---
name: arch-audit
description: Audit architecture and design consistency. Use when reviewing module boundaries, import cycles, extension seams, pattern adherence, or contract drift.
---

# Arch Audit

Use this skill when asked to review architecture quality, design consistency, extension seams, or pattern adherence.

## Scope

Indirection pressure (primary focus):
- runtime import cycles across split modules
- pass-through facade modules that only rename or re-export behavior
- alias/wrapper layers without independent policy or contract value
- dependency-injection bags that exceed practical seam/testing needs
- thin wrappers that only forward calls without adding policy (e.g. `runX -> runY`)

Extension blockers:
- hard-coded behavior where policy/config seam is expected
- new feature requiring edits across many unrelated modules
- private coupling that prevents additive toolkits/transports/providers
- boundary leaks that force consumers to depend on internal module order

Other areas:
- lifecycle phase boundaries and evaluator-driven behavior
- tool architecture (toolkits, registry, guarded execution)
- contracts/schemas as source of truth (Zod + inferred types)
- transport and protocol consistency (HTTP/RPC parity)
- guard/evaluator extensibility without test-only production hacks
- error contracts and typed error model consistency
- assert patterns and exhaustiveness (`invariant`, `unreachable`, `switch` with `default`)
- design-pattern consistency for extension seams (policy/strategy tables, adapter boundaries)
- error-model consistency (`AppError`/coded errors, stable searchable codes, clear UX messages)
- file cohesion and split hygiene (flag oversized/multi-responsibility files; prefer small focused modules)
- SRP violations: functions/modules that mix concerns (e.g. persistence + display, mutation + rendering)

## References

Read first:
- `docs/architecture.md`
- `AGENTS.md`
- `docs/roadmap.md` (pre-MVP vs post-MVP intent)

Then inspect relevant code:
- `src/lifecycle*.ts`
- `src/tool-guards.ts`
- `src/*tools*.ts`
- `src/*protocol*.ts`, `src/server*.ts`, `src/client*.ts`
- `src/config*.ts`

## Audit Workflow

1. Build the expected architecture map from docs/contracts.
2. Compare implementation against that map:
   - run a cycle pass on core entrypoints/splits (`cli*`, `server*`, `client*`, `lifecycle*`)
   - flag wrapper modules/functions that only proxy one call and add no invariants/policy
3. Report findings ordered by severity:
   - correctness/regression risk
   - contract drift / protocol mismatch
   - extension-blocking design smells
   - indirection overhead / abstraction tax
   - maintainability issues
4. For each finding include:
   - impacted files
   - why it violates intended pattern
   - minimal fix direction
5. Only propose abstractions that pass YAGNI and Rule of Three.
6. Flag SRP violations — functions that bundle unrelated responsibilities should be split.
7. Prefer de-abstraction when appropriate:
   - collapse pass-through layers with no policy value
   - break cycles by moving shared primitives to contract/helper modules
   - keep entrypoints thin but avoid "facade-for-facade" chains
   - default stance: if a layer does not carry policy, invariants, or boundary isolation, remove it

## Output Format

- Findings first, ordered by severity (no long preamble).
- For each finding include:
  - impacted files
  - why it violates intended pattern
  - minimal fix direction
- Separate into:
  - confirmed issues
  - open questions/assumptions
  - optional follow-up refactors

## Anti-Patterns

- Suggesting speculative frameworks or plugin systems.
- Broad rewrites over small contract-preserving changes.
- Implementation-detail docs that drift from reality.
