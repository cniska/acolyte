# Acolyte Development Workflow

## Purpose
Define a consistent way to implement features autonomously while validating each step.

## Feature Loop
1. Define the target outcome in one sentence.
2. Write explicit acceptance checks (behavior + commands).
3. Break work into small slices that can be validated independently.
4. Implement one slice at a time.
5. Run validation for that slice immediately.
6. Commit the slice.
7. Repeat until acceptance checks pass.

## Validation Gates
Use these gates after each meaningful slice:

1. Static checks:
   - `bun run typecheck`
2. Unit tests:
   - `bun run test`
3. Baseline bundle:
   - `bun run verify`
4. Targeted smoke checks for changed behavior:
   - Example: `bun run tool ...`, `bun run chat`, `bun run status`

## Commit Rules
1. One logical slice per commit.
2. Commit message describes shipped behavior, not implementation detail.
3. Do not mix unrelated files in the same commit.

## Documentation Rules
1. Update `docs/talk-notes.md` for shipped milestones.
2. Update `docs/project-plan.md` when priorities or next actions change.
3. Keep `README.md` command examples in sync with scripts and UX.

## Definition of Done
A feature is done when:
1. Acceptance checks pass.
2. `bun run verify` passes.
3. Relevant smoke checks pass.
4. Docs are updated.
5. The final output is user-focused and concise.
