---
name: review
description: Run all audit skills (style, arch, docs, security) against the current branch diff. Use when reviewing a feature branch before merge.
---

# Review

Run all four audit skills against the current branch to produce a unified review.

## Workflow

1. Determine the diff scope:
   - Run `git log main..HEAD --oneline` and `git diff main...HEAD --stat` to identify changed files and commits.
   - If the branch has no commits ahead of main, report that and stop.

2. Read the changed files in full (not just the diff) so findings have surrounding context.

3. Read the reference docs before auditing:
   - `AGENTS.md`
   - `docs/architecture.md`

4. Run each audit against the changed files, following the workflow and scope defined in each skill:
   - **Style audit** — `.agents/skills/style-audit/SKILL.md`
   - **Arch audit** — `.agents/skills/arch-audit/SKILL.md`
   - **Docs audit** — `.agents/skills/docs-audit/SKILL.md`
   - **Security audit** — `.agents/skills/security-audit/SKILL.md`

5. Produce a single unified report.

## Output Format

### Style
- Findings ordered by severity per style-audit skill.

### Architecture
- Findings ordered by severity per arch-audit skill.

### Docs
- Findings ordered by severity per docs-audit skill.

### Security
- Findings ordered by severity per security-audit skill.

### Summary
- Table: category | must-fix | should-fix | optional counts.
- Top actionable items before merge.
