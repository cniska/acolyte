---
name: review
description: Run all review skills against the current branch diff. Use when reviewing a feature branch before merge.
---

# Review

Run all review dimensions against the current branch and produce one unified review. Approve when a change improves overall code health, even if it isn't perfect.

## Scope

Review only what changed on the current branch against `main`, but read enough surrounding code and docs to understand conventions and boundaries.

Do not duplicate the same issue across categories.

## Change sizing

Before reviewing, check the diff size:

- ~100 lines: good, reviewable in one pass.
- ~300 lines: acceptable if one logical change.
- ~1000 lines: too large — ask the author to split before reviewing.

Refactoring mixed with feature work is two changes. Flag it.

## Workflow

1. Determine diff scope: `git log main..HEAD --oneline` and `git diff main...HEAD --stat`.
2. If no commits ahead of `main`, report that and stop.
3. Read changed files in full, plus project instructions and architecture docs.
4. **Review tests first** — they reveal intent and coverage gaps.
5. Run each review dimension: **Style**, **Architecture**, **Docs**, **Security**, **Tests**. Load the corresponding skill for each dimension when possible.
6. Merge findings: deduplicate, keep strongest framing per root issue.
7. Label every finding by severity:

| Label | Meaning | Action |
|-------|---------|--------|
| *(unmarked)* | Must fix | Address before merge |
| **Critical:** | Blocks merge | Security, data loss, broken functionality |
| **Nit:** | Optional | Style preference, minor improvement |
| **Consider:** | Suggestion | Worth thinking about, not required |

8. Order by merge relevance: must-fix → should-fix → optional.

## Dependency review

If the change adds a dependency, check:
- Does the existing stack already solve this?
- Is it actively maintained?
- What's the size impact?
- Any known vulnerabilities?

Every dependency is a liability.

## Output

One section per review dimension (Style, Architecture, Documentation, Security, Tests), then a summary table: `category | must-fix | should-fix | optional`. Note categories with no findings.

## Fix policy

Default to fixing all findings — including trivial ones. Small issues left unfixed accumulate into tech debt. If a finding is worth reporting, it's worth fixing before merge.

## Red flags

- Reviewing only the diff without reading touched files in context
- Duplicating the same root issue across categories
- Generic cleanup wishlists
- Speculative issues without evidence
- Broad rewrite suggestions out of scope
- "LGTM" without evidence of review
- Softening real issues — if it's a bug, say so directly
- Accepting "I'll fix it later" — require cleanup before merge
