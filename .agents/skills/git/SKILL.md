---
name: git
description: Git workflow for atomic commits, change sizing, and safe versioning. Use when committing, branching, or managing change history.
---

# Git

Commits are save points, branches are sandboxes, history is documentation. Treat them accordingly.

## Commit discipline

- **Commit after each successful slice.** Don't accumulate work — a commit is a save point you can return to.
- **One logical change per commit.** A commit that refactors and adds a feature is two commits.
- **Format:** `type(scope): description` — under 72 chars, ASCII only, no body.
- **Explain intent, not mechanics.** "feat(tools): add workspace scope for cross-file edits" not "add new function to tools file."

## Change sizing

- ~100 lines per commit: good.
- ~300 lines: acceptable if one logical change.
- 1000+ lines: too large — split it.

Separate refactoring from feature work. Separate formatting from behavior changes.

## Branch workflow

- Start from latest `main`.
- Branch names: hyphens, no slashes, no prefixes (`workspace-scope`, not `feature/workspace-scope`).
- Keep branches short-lived — merge within days, not weeks.
- Never amend commits already pushed to remote.
- Use `--force-with-lease` over `--force`.

## Save-point pattern

When exploring uncertain changes, commit early with a clear message. If the approach doesn't work out, you can revert cleanly. Uncommitted work can't be reverted — only lost.

## Change summaries

After a set of changes, provide a structured summary:
- **What changed** — the diff in plain language
- **What was intentionally excluded** — scope discipline
- **What to watch** — potential concerns for reviewers

## Red flags

- Long-lived branches diverging from main
- Commits with "misc", "fix", "update" as the entire message
- Force-pushing to shared branches
- Mixing unrelated changes in one commit
- Working without committing for extended periods
