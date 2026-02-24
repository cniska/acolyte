# Development Workflow

## Purpose
Define a consistent way to implement features autonomously while validating each step.

## Related Guide
1. Day-to-day dogfood playbook: `docs/dogfood-workflow.md`

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
   - `bun run verify` (`format + lint + typecheck + test`, with Biome recommended rules enabled)
4. Targeted smoke checks for changed behavior:
   - Example: `bun run src/cli.ts tool ...` (internal/debug), `bun run start`, `bun run src/cli.ts status`, `bun run dogfood:smoke`
5. Optional switch-readiness check:
   - Gate check: `bun run dogfood:gate --lookback 30 --target 10 --skip-verify`

Internal-only telemetry (not primary end-user commands):
1. `bun run dogfood:progress --lookback 30 --target 10 [--json]`
2. `bun run dogfood:gate --lookback 30 --target 10`

## Dogfooding Ramp
Use this staged rollout when shifting work from Codex-driven to assistant-driven execution on `main`:

1. Level 1 (safe):
   - Docs-only edits, help text, naming cleanups, and no-behavior refactors.
2. Level 2 (low risk):
   - Add tests for existing behavior, parser/formatter fixes, and UX copy polish.
3. Level 3 (moderate):
   - Small isolated feature slices with explicit acceptance checks.
4. Level 4 (higher risk):
   - Multi-file behavior changes and workflow-affecting updates.

Escalation rules:
1. Start each new capability at Level 1 and climb only after consistent green `bun run verify`.
2. If a slice fails twice, drop one level and split into smaller slices.
3. Keep commit-per-slice and avoid mixing risk levels in one commit.

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
