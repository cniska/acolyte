---
name: docs-audit
description: Audit docs for drift, missing updates, and terminology changes.
---

# Documentation Audit

Review doc coverage, terminology drift, and canonical doc accuracy.

## Scope

- canonical doc updates for behavior, contract, or config changes
- glossary drift when new terms are introduced
- duplicated concepts across `README.md` and `docs/*`
- outdated names or contracts after refactors
- `docs/features.md` discipline: shipped features only, one line, user-visible wording
- docs staying conceptual rather than describing implementation line-by-line

## Style conventions

- One H1 per doc (page title). Headings follow semantic order.
- H1 title case, H2+ sentence case.
- Bullets starting with a word or phrase use a capital letter.
- No unnecessary fenced code blocks for content that reads as prose.

## Output

For each finding: **severity**, **affected file**, **what drifted or is missing**, **fix direction**.

Then: **Canonical updates needed** | **Optional cleanup**.

## Anti-patterns

- Generic prose polishing
- Duplicate explanations across docs
- Implementation detail where a concept is enough
- Treating roadmap notes as shipped behavior
