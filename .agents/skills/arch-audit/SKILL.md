---
name: arch-audit
description: Audit architecture and design consistency. Use when reviewing module boundaries, import cycles, extension seams, pattern adherence, or contract drift.
---

# Architecture Audit

Use this skill when asked to review architecture quality, design consistency, extension seams, or pattern adherence.

## Scope

### 1. Indirection pressure (primary focus)

Flag layers that add little or no architectural value:

- runtime import cycles across split modules
- pass-through facade modules that only rename or re-export behavior
- alias or wrapper layers without independent policy, invariants, or boundary value
- dependency-injection bags that exceed practical seam or testing needs
- singleton imports in library modules that should accept injected params (see DI section in `docs/architecture.md`)
- thin wrappers that only forward calls without adding policy (for example `runX -> runY`)
- facade-for-facade chains where each layer only forwards the call

Default stance:

> If a layer does not carry policy, invariants, or boundary isolation, remove it.

### 2. Extension blockers

Flag design choices that make additive change harder than necessary:

- hard-coded behavior where a policy or config seam is expected
- new feature requiring edits across many unrelated modules
- private coupling that prevents additive toolkits, transports, or providers
- boundary leaks that force consumers to depend on internal module order
- extension seams that exist in theory but have no current product use and add maintenance cost

### 3. Boundary and contract integrity

Check that implementation matches intended architecture:

- lifecycle phase boundaries and evaluator-driven behavior
- tool architecture (toolkits, registry, guarded execution)
- contracts and schemas as source of truth (Zod + inferred types)
- transport and protocol consistency (HTTP/RPC parity where relevant)
- guard and evaluator extensibility without test-only production hacks
- error contracts and typed error model consistency
- assert patterns and exhaustiveness (`invariant`, `unreachable`, exhaustive `switch`)
- DI convention: `*Deps` for config, `*Input` for runtime, defaults from `appConfig` at composition roots
- design-pattern consistency for extension seams (policy tables, strategy maps, adapters)

### 4. Cohesion and responsibility

Flag local design problems that hurt maintainability:

- oversized or multi-responsibility files
- SRP violations: functions or modules mixing unrelated concerns (for example persistence + display, mutation + rendering)
- changes that require touching too many unrelated modules for one feature
- boundary-local duplication is acceptable if it preserves clarity; do not force DRY across seams unless repetition is already creating maintenance cost

### 5. Portability and product fit

Flag assumptions that reduce intended flexibility:

- hard-coded runtime, language, or framework-specific assumptions that violate documented goals
- design choices that undermine language-agnostic or product-level behavior promised in docs
- abstractions that look framework-first instead of product-first

## Evidence threshold

Only report an architecture issue when there is concrete evidence in code, contracts, or dependency flow.

Do not infer architectural drift from naming alone.

For each finding, point to at least one of:

- concrete dependency direction
- contract mismatch
- boundary leakage
- unnecessary indirection
- extension friction observed in the current change

Prefer demonstrated issues over speculative concerns.

## References

Read first:

- `docs/architecture.md`
- `AGENTS.md`
- `docs/roadmap.md` (pre-MVP vs post-MVP intent)

Then inspect relevant code, especially:

- `src/lifecycle*.ts`
- `src/tool-guards.ts`
- `src/*tools*.ts`
- `src/*protocol*.ts`
- `src/server*.ts`
- `src/client*.ts`
- `src/config*.ts`

Expand beyond these files if the review diff or dependency flow leads elsewhere.

## Audit workflow

1. Build the expected architecture map from docs and contracts.
2. Compare implementation against that map.
3. Run a cycle and indirection pass on core entrypoints and split modules (`cli*`, `server*`, `client*`, `lifecycle*`).
4. Flag wrappers, facades, or adapters that add no policy, invariants, or isolation value.
5. Check whether the current change increases coupling, weakens seams, or creates contract drift.
6. Report findings ordered by severity:
   - correctness or regression risk
   - contract drift or protocol mismatch
   - extension-blocking design smells
   - indirection overhead or abstraction tax
   - maintainability issues
7. For each finding, include:
   - impacted files
   - why it violates intended pattern
   - concrete evidence
   - minimal fix direction
8. Only propose abstractions that pass YAGNI and Rule of Three.
9. Prefer de-abstraction when appropriate:
   - collapse pass-through layers with no policy value
   - break cycles by moving shared primitives to contract or helper modules
   - keep entrypoints thin but avoid facade chains
10. Distinguish confirmed issues from open questions and taste-level concerns.

## Output format

Findings first, ordered by severity. No long preamble.

For each finding include:

- **severity**
- **impacted files**
- **why it violates intended pattern**
- **concrete evidence**
- **minimal fix direction**

Then separate the rest into:

- **Confirmed issues**
- **Open questions / assumptions**
- **Optional follow-up refactors**

## Review rules

- Prefer small contract-preserving fixes over broad rewrites.
- Prefer removal of unnecessary abstraction over adding new abstraction.
- Do not recommend plugin systems, frameworks, or generic extension APIs without a clear present need.
- Do not mistake unfamiliarity for drift; anchor comments in documented architecture.
- Do not flag focused local duplication when it preserves seam clarity.
- Do not suggest implementation-detail docs that drift from reality.

## Anti-patterns

- Suggesting speculative frameworks or plugin systems
- Broad rewrites instead of minimal structural fixes
- Treating taste-level preferences as architectural defects
- Recommending abstractions with no current product use
- Over-indexing on DRY when duplication is boundary-local and intentional