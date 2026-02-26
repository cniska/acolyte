---
name: dogfood
description: Build features end-to-end in small validated slices with commit-per-slice discipline.
---

# Dogfood

Use this skill for Acolyte development where the goal is autonomous, end-to-end delivery with measurable readiness gates.

## Workflow
1. Define the feature outcome and acceptance checks.
2. Split implementation into small, independently verifiable slices.
3. Implement one slice at a time.
4. For coding prompts, include explicit target file path(s) and required response shape (for example summary only).
5. Validate each slice immediately.
6. Commit each successful slice before starting the next.
7. Keep docs and scripts synchronized with shipped behavior.

## Validation
Run after each meaningful slice:
1. `bun run verify`
2. Targeted smoke command(s) for changed behavior (for example `bun run tool ...`, `bun run chat`, `bun run status`)

For autonomy readiness:
1. `bun run dogfood:smoke`
2. `bun run dogfood:gate`

If validation fails:
1. Fix root cause before moving on.
2. Re-run validation.

## Autonomy Rules
1. Treat fallback edit responses and read/search-only behavior as blockers for coding tasks.
2. Do not mark work complete unless the required gate checks pass.
3. Keep focus on shippable behavior and user-visible quality over internal polish.
4. For edit requests, require at least one successful edit tool call before reporting success.

## Commit Policy
1. One logical slice per commit.
2. Conventional commits only.
3. Keep commit messages outcome-focused.

## Required Doc Sync
1. Update `docs/talk-notes.md` for shipped milestones.
2. Update `docs/roadmap.md` for priority/next-action changes.
3. Keep command docs in `README.md` current.

## Reference
- `AGENTS.md` for project rules and validation gates.
