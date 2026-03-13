---
name: docs-audit
description: Audit canonical docs for drift, missing glossary updates, duplicated concepts, and contract changes not reflected in docs. Use when reviewing documentation quality, terminology changes, or doc updates for shipped behavior.
---

# Docs Audit

Use this skill when asked to review documentation quality, canonical doc coverage, terminology drift, or whether code changes were reflected in docs.

## Scope

Focus on:
- canonical doc coverage for behavior, contract, or config changes
- glossary drift when new architectural terms are introduced
- duplicated concepts across `README.md` and `docs/*`
- outdated names or contracts after refactors
- `docs/features.md` discipline: shipped features only, one line, user-visible wording
- docs staying conceptual and resistant to drift rather than describing implementation line-by-line
- missing updates to the right canonical doc when behavior changes
- user-facing wording accuracy for modes, lifecycle behavior, tools, memory, RPC, and config

Canonical docs to prefer:
- `README.md` for project entrypoint and high-level usage
- `docs/architecture.md` for system shape and boundaries
- `docs/lifecycle.md` for lifecycle contracts and mode flow
- `docs/glossary.md` for shared terminology
- `docs/features.md` for shipped feature inventory
- `docs/roadmap.md` for near-term direction, not shipped behavior

## References

Read first:
- `AGENTS.md`
- `README.md`
- relevant canonical docs under `docs/`

Then inspect the changed code and changed docs together.

## Audit Workflow

1. Identify the behavior, contract, terminology, or config changes in the diff.
2. Determine which canonical doc should describe each change.
3. Check for:
   - missing doc updates
   - stale terminology
   - duplicated or conflicting explanations
   - implementation-heavy wording that should be compressed into a stable concept
4. Report findings ordered by severity:
   - incorrect or conflicting docs
   - missing canonical updates
   - glossary/terminology drift
   - duplication or readability issues
5. For each finding include:
   - affected file(s)
   - what drifted or is missing
   - minimal fix direction

## Output Format

- Findings first, ordered by severity.
- For each finding include:
  - affected file(s)
  - what drifted or is missing
  - minimal fix direction
- Then list:
  - canonical doc updates needed
  - optional cleanup

## Anti-Patterns

- Turning docs review into generic prose polishing.
- Recommending duplicate explanations across multiple docs.
- Adding implementation detail where a stable concept is enough.
- Treating roadmap notes as shipped behavior.
- Expanding `docs/features.md` with internal implementation details.
