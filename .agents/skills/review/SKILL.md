---
name: review
description: Run all audit skills against the current branch diff.
---

# Review

Run the full audit suite against the current branch and produce one unified review.

## Scope

Review only what changed on the current branch against `main`, but read enough surrounding code and docs to understand conventions and boundaries.

Do not duplicate the same issue across categories.

## Workflow

1. Determine diff scope: `git log main..HEAD --oneline` and `git diff main...HEAD --stat`.
2. If no commits ahead of `main`, report that and stop.
3. Read changed files in full, plus `AGENTS.md` and `docs/architecture.md`.
4. Run each audit:
   - **Style** — `.agents/skills/style-audit/SKILL.md`
   - **Architecture** — `.agents/skills/arch-audit/SKILL.md`
   - **Docs** — `.agents/skills/docs-audit/SKILL.md`
   - **Security** — `.agents/skills/security-audit/SKILL.md`
   - **Tests** — `.agents/skills/test-audit/SKILL.md`
5. Merge findings: deduplicate, keep strongest framing per root issue.
6. Order by merge relevance: must-fix → should-fix → optional.

## Output

One section per audit category (Style, Architecture, Documentation, Security, Tests), then a summary table: `category | must-fix | should-fix | optional`. Note categories with no findings.

## Anti-patterns

- Reviewing only the diff without reading touched files in context
- Duplicating the same root issue across categories
- Generic cleanup wishlists
- Speculative issues without evidence
- Broad rewrite suggestions out of scope
