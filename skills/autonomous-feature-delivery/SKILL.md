---
name: autonomous-feature-delivery
description: Build features end-to-end in small validated slices with commit-per-slice discipline.
---

# Autonomous Feature Delivery

Use this skill for project development tasks where the goal is to ship features with high confidence and minimal back-and-forth.

## Workflow
1. Define the feature outcome and acceptance checks.
2. Split implementation into small, independently verifiable slices.
3. Implement one slice at a time.
4. Validate each slice immediately.
5. Commit each successful slice before starting the next.
6. Keep docs and scripts synchronized with shipped behavior.

## Validation
Run after each meaningful slice:
1. `bun run verify`
2. Targeted smoke command(s) for changed behavior (for example `bun run tool ...`, `bun run chat`, `bun run status`)

If validation fails:
1. Fix root cause before moving on.
2. Re-run validation.

## Commit Policy
1. One logical slice per commit.
2. Conventional commits only.
3. Keep commit messages outcome-focused.

## Required Doc Sync
1. Update `docs/talk-notes.md` for shipped milestones.
2. Update `docs/project-plan.md` for priority/next-action changes.
3. Keep command docs in `README.md` current.

## Reference
For full process details and completion criteria, follow:
- `docs/development-workflow.md`
