---
name: architecture-review
description: Review architecture, boundaries, and design consistency. Use when reviewing module boundaries, extension seams, or contract drift.
---

# Architecture Review

Review architecture quality, design consistency, extension seams, and pattern adherence.

## Scope

### 1. Indirection pressure (primary focus)

Flag layers that add no architectural value:

- runtime import cycles across split modules
- pass-through facades that only rename or re-export
- alias/wrapper layers without independent policy or invariants
- DI bags exceeding practical seam or testing needs
- singleton imports in library modules that should accept injected params
- facade-for-facade chains

Default: if a layer carries no policy, invariants, or boundary isolation, remove it.

### 2. Extension blockers

- hard-coded behavior where project docs or an existing sibling seam establish a policy/config point
- new features requiring edits across many unrelated modules
- private coupling preventing additive providers or plugins
- extension seams with no current use adding maintenance cost

### 3. Boundary and contract integrity

- contracts and schemas as source of truth
- renamed contract terms stay aligned across the boundary; partial renames count as drift
- dependency direction consistency
- design-pattern consistency for extension seams

### 4. Cohesion and responsibility

- oversized or multi-responsibility files
- SRP violations: mixing unrelated concerns
- boundary-local duplication is acceptable if it preserves clarity

### 5. Portability and product fit

- hard-coded runtime/framework assumptions violating documented goals
- abstractions that look framework-first instead of product-first

## Evidence threshold

Only report issues with concrete evidence in code, contracts, or dependency flow. Prefer demonstrated issues over speculative concerns.

## Workflow

1. Build expected architecture map from project docs.
2. Compare implementation against that map.
3. Run cycle and indirection pass on core entrypoints.
4. Check whether the change increases coupling or creates contract drift.
5. Report findings ordered by severity.

## Output

For each finding: **label** (Critical / Fix / Consider / Nit — see `review`), **impacted files**, **violated pattern**, **evidence**, **fix direction**.

- Bad: "Consider: UserService is doing a lot; could be more decoupled." (taste, no contract, no evidence)
- Good: **Fix** — `src/api/client.ts` imports `src/auth/session.ts` which imports it back (runtime cycle), violating the api→auth dependency direction in `docs/architecture.md`. Move `TokenStore` into `auth`.

Group as **Confirmed issues** | **Open questions** | **Optional refactors** (max 3, one line each; omit if empty). "No architectural findings" is a valid, complete result.

## Red flags

- Suggesting speculative frameworks or plugin systems
- Broad rewrites instead of minimal structural fixes
- Treating taste-level preferences as defects
- Recommending abstractions with no current product use
- Over-indexing on DRY when duplication is boundary-local
