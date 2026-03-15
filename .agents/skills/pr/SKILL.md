---
name: pr
description: Create a pull request for the current branch. Infers title and description from the diff, follows project PR conventions.
---

# PR

Create a pull request for the current branch against `main`.

## Conventions

- Title: short, imperative, Conventional Commit format (`feat(scope): ...`), 60 char max, no trailing period
- Body: follow `.github/pull_request_template.md` exactly — fill in each section, do not add or remove sections
- Bullets: plain English, describe *what* changed and *why*, not implementation details — no code blocks

## Workflow

1. Run the review skill (`.agents/skills/review/SKILL.md`) first. If there are must-fix findings, stop and report them before creating the PR.
2. Read `.github/pull_request_template.md` to get the required body structure
3. Run `git log main..HEAD --oneline` to see commits on the branch
4. Run `git diff main...HEAD --stat` to see changed files
5. Run `git diff main...HEAD` to read the full diff
6. Run `gh issue list` to check for an associated issue. If one matches the branch work, add `Fixes #<number>` as the first line of the body, before the template sections.
7. Infer a title and fill in the template body from the above
8. Check if the branch is already pushed: `git status -sb`
9. If not pushed, push with `git push -u origin HEAD`
10. Create the PR with `gh pr create`
11. Return the PR URL

## Output

Return only the PR URL.
