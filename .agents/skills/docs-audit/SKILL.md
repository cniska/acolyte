---
name: docs-audit
description: Audit canonical docs for drift, missing updates, and terminology changes. Use when reviewing whether code changes are reflected in docs.
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

Canonical docs: `README.md`, `docs/architecture.md`, `docs/lifecycle.md`, `docs/modes.md`, `docs/memory.md`, `docs/sessions-tasks.md`, `docs/protocol.md`, `docs/configuration.md`, `docs/cli.md`, `docs/tui.md`, `docs/tooling.md`, `docs/glossary.md`, `docs/features.md`, `docs/roadmap.md`.

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
