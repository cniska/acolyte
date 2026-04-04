---
name: ship
description: Pre-deploy gate with version bump and automated release. Use when ready to cut a release.
---

# Ship

Run a structured pre-deploy checklist, determine the version bump, and execute the release.

## Scope

Check the entire project. This is a release gate, not a diff review.

## References

- `scripts/release.sh`
- `CHANGELOG.md`
- `docs/features.md`

## Workflow

1. Verify preconditions (all must pass to proceed):
   - on `main` branch
   - working directory is clean
   - `bun run verify` passes (lint, typecheck, tests)
   - no secrets in tracked files: grep for `sk-`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `Bearer`, private keys in non-`.env` tracked files
2. Run quality checks (warn if any fail):
   - no `TODO` or `FIXME` in non-test source files
   - commits exist since the last tag
   - `docs/features.md` covers capabilities introduced by commits since last tag (cross-reference `feat` commit subjects)
   - run the `/benchmark` skill to refresh `docs/benchmarks.md`
3. Determine version bump from commits since last tag:
   - run `git describe --tags --abbrev=0 --match 'v[0-9]*'` to find the previous tag
   - run `git log <prev_tag>..HEAD --oneline --no-merges` to list commits
   - `major` — any commit contains `BREAKING CHANGE` in the body or `!:` in the subject
   - `minor` — any commit subject matches `feat(` or `feat:`
   - `patch` — everything else
4. Report findings using the output format below.
5. Ask for confirmation before proceeding.
6. Run `bash scripts/release.sh <level>`. This runs verify, generates the changelog entry, and creates the commit and tag.
7. Show the push commands from the release script output. Do not push.

## Output format

### Preconditions
- ✅ or ❌ per check, with failure details

### Quality
- ✅ or ⚠️ per check

### Commits
- One-line list of commits since last tag

### Version
- Previous → proposed (`<level>` — reason)

### Verdict
- **Ship it** — all preconditions pass, no quality warnings
- **Fix first** — preconditions failing
- **Ship with caution** — preconditions pass, quality warnings present

## Rules

- Never run `release.sh` if any precondition fails.
- Always ask for confirmation before running `release.sh`.
- Never push — print the push commands for the user.
- If there are no commits since the last tag, stop and report that.

## Red flags

- Running the release without checking preconditions
- Guessing the version bump without reading the commits
- Pushing without user confirmation
- Skipping quality checks because preconditions passed
