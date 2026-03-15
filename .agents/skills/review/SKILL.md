---
name: review
description: Run all audit skills (style, arch, docs, security) against the current branch diff. Use when reviewing a feature branch before merge.
---

# Review

Run the full audit suite against the current branch and produce one unified review.

Use this skill when reviewing a feature branch before merge.

## Scope

Review only what changed on the current branch against `main`, but read enough surrounding code and docs to understand the local conventions, intended architecture, and security boundaries.

The review should combine findings from:

- **Style audit**
- **Architecture audit**
- **Docs audit**
- **Security audit**

Do not duplicate the same issue across categories unless the problem is meaningfully different in each one.

## References

Read first:

- `AGENTS.md`
- `docs/architecture.md`

Then inspect the changed files in full, not just the diff.

If the change touches architecture, protocol, tools, lifecycle, config, transport, docs, or security-sensitive code, expand outward as needed to establish context.

## Workflow

1. Determine the diff scope:
   - run `git log main..HEAD --oneline`
   - run `git diff main...HEAD --stat`
   - identify changed files and commits
2. If the branch has no commits ahead of `main`, report that and stop.
3. Read the changed files in full so findings are grounded in surrounding context.
4. Read the core reference docs:
   - `AGENTS.md`
   - `docs/architecture.md`
5. Run each audit against the changed files, following the workflow and scope defined in each skill:
   - **Style audit** — `.agents/skills/style-audit/SKILL.md`
   - **Architecture audit** — `.agents/skills/arch-audit/SKILL.md`
   - **Documentation audit** — `.agents/skills/docs-audit/SKILL.md`
   - **Security audit** — `.agents/skills/security-audit/SKILL.md`
6. Merge the findings into one unified report:
   - deduplicate overlapping findings
   - keep the strongest framing when multiple audits identify the same root issue
   - preserve category-specific findings where they are materially distinct
7. Order findings by practical merge relevance:
   - must-fix before merge
   - should-fix soon
   - optional follow-up
8. Keep the review focused on concrete issues in the current branch, not general cleanup ideas.

## Evidence threshold

Only report findings that are supported by the current diff, surrounding code, documented conventions, or concrete boundary analysis.

Do not inflate the review with speculative concerns.

Prefer a short, high-signal review over exhaustive but weak commentary.

## Output format

### Style
- Findings ordered by severity per `style-audit`
- Include only distinct style findings that are not better explained under another category

### Architecture
- Findings ordered by severity per `arch-audit`

### Docs
- Findings ordered by severity per `docs-audit`

### Security
- Findings ordered by severity per `security-audit`

### Summary
Include:

- a table with: `category | must-fix | should-fix | optional`
- top actionable items before merge
- note any category with **no findings**

## Review rules

- Read changed files in full before judging the diff.
- Prefer concrete branch-specific findings over general advice.
- Do not repeat the same issue in multiple sections unless the implications are genuinely different.
- Prefer minimal, actionable fixes over broad rewrites.
- Anchor comments in repo conventions and documented architecture.
- If a category has no meaningful findings, say so clearly.

## Anti-patterns

- Reviewing only the diff without reading the touched files in context
- Duplicating the same root issue across style, architecture, docs, and security
- Turning the review into a generic cleanup wishlist
- Reporting speculative issues without evidence in the branch
- Broad rewrite suggestions that are out of scope for the current change