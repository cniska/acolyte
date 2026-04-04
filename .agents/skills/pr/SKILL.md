---
name: pr
description: Create a pull request with review and verify. Use when the branch is ready to merge.
---

# PR

Create a pull request for the current branch against `main`.

## Conventions

- Title: Conventional Commit format (`type(scope): description`), under 60 chars, no trailing period
- Body: follow `.github/pull_request_template.md` exactly — fill in each section, do not add or remove sections
- Bullets: plain English, describe *what* changed and *why* — no prose paragraphs
- Inline code only when the identifier is essential to understanding the change
- If an issue matches the branch work, add `Fixes #<number>` at the end of the body

## Workflow

1. **Check preconditions** (all must pass before continuing):
   - working directory is clean (`git status`)
   - branch has commits ahead of `main` (`git log main..HEAD --oneline`)
   - `bun run verify` passes
2. **Run the review skill** (`.agents/skills/review/SKILL.md`):
   - if there are must-fix findings, stop and report them — do not create the PR
3. **Gather context**:
   - read `.github/pull_request_template.md`
   - run `git log main..HEAD --oneline` to see commits
   - run `git diff main...HEAD --stat` to see changed files
   - run `git diff main...HEAD` to read the full diff
   - run `gh issue list` to check for an associated issue
4. **Draft the PR**:
   - infer a title from the commits and diff
   - fill in the template body
5. **Push if needed**:
   - check remote tracking: `git status -sb`
   - if not pushed: `git push -u origin HEAD`
6. **Create the PR**:
   - `gh pr create --title "..." --body "..."`
7. **Return only the PR URL**

## Rules

- Never create a PR with uncommitted changes in the working directory
- Never create a PR without running verify first
- Never create a PR with must-fix review findings
- Never push without checking remote tracking status first
- Always read the PR template before drafting the body
- Always check for associated issues

## Red flags

- Skipping verify because "tests passed earlier"
- Skipping the review because it takes time
- Writing the PR body without reading the template
- Pushing before checking if the branch already tracks a remote
- Creating the PR without checking for associated issues
