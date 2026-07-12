---
name: doc-review
description: Review docs for drift, missing updates, and terminology changes. Use when code changes should be reflected in documentation.
---

# Documentation Review

Review the docs the diff affects for drift — terms, contracts, and behavior the change made stale.

## Scope

Report only drift caused or exposed by the diff. Pre-existing doc debt untouched by the change is out of scope unless the change makes it actively wrong.

- canonical doc updates for behavior, contract, or config changes
- glossary drift when new terms are introduced
- duplicated concepts introduced or worsened by this change
- outdated names or contracts after refactors
- new or changed docs staying conceptual rather than describing implementation

## Style conventions

Apply these only to lines the change adds or modifies — never flag untouched text.

- One H1 per doc (page title). Headings follow semantic order.
- H1 title case, H2+ sentence case.
- Bullets starting with a word or phrase use a capital letter.
- No unnecessary fenced code blocks for content that reads as prose.

## Workflow

Read the diff, then the affected doc files. Verify each drift against the code before reporting.

## Output

For each finding: **label** (Critical / Fix / Consider / Nit — see `review`), **affected file**, **what drifted or is missing**, **fix direction**.

- Bad: "README could explain the retry architecture in more depth."
- Good: **Fix** — `docs/config.md` still says `maxRetries` defaults to 3; this diff changes it to 5 in `src/client.ts`.

Group as **Canonical updates needed** | **Optional cleanup** (max 3, each tied to a file the diff touched; omit if empty). If nothing drifted, say "No doc findings".

## See also

- `review` for cross-dimension merge decisions

## Red flags

- Generic prose polishing
- Duplicate explanations across docs
- Implementation detail where a concept is enough
- Treating roadmap notes as shipped behavior
