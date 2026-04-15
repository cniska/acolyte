---
name: architecture
description: Review architecture, boundaries, and design consistency.
---

# Architecture

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

- hard-coded behavior where a policy/config seam is expected
- new features requiring edits across many unrelated modules
- private coupling preventing additive providers or plugins
- extension seams with no current use adding maintenance cost

### 3. Boundary and contract integrity

- contracts and schemas as source of truth
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

For each finding: **severity**, **impacted files**, **violated pattern**, **evidence**, **fix direction**.

Then: **Confirmed issues** | **Open questions** | **Optional refactors**.

## Red flags

- Suggesting speculative frameworks or plugin systems
- Broad rewrites instead of minimal structural fixes
- Treating taste-level preferences as defects
- Recommending abstractions with no current product use
- Over-indexing on DRY when duplication is boundary-local
