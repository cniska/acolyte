# Project Rules

## Tooling

- Prefer repository scripts and task runners over ad-hoc commands.
- Use documented commands when available.

## Workflow

- Start from latest `main` before new work.
- Read relevant files before editing.
- Keep changes scoped, minimal, and well-engineered.
- Prefer editing existing files over creating new ones unless necessary.
- Do not guess; use concrete evidence (errors, logs, tests, source) before changing code.
- Stop and ask if unexpected diffs or artifacts appear.
- Default to autonomous execution for straightforward improvements and continue without explicit confirmation.
- Only pause for confirmation when decisions are ambiguous, risky, or irreversible.

## Commits

- Commit only when explicitly requested.
- Use Conventional Commit format: `type(scope): description`.
- Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- Keep commit subject lines under 72 characters.

## Code

- Choose pragmatic solutions with low maintenance overhead.
- Avoid unnecessary indirection and abstractions.
- Prefer root-cause fixes over workaround-only patches.
- Do not add technical debt unless explicitly agreed with the user and tracked with `TODO(username):` plus a docs note.
- Remove temporary debug code before review/commit.

## Validation

- Run relevant validation after changes.
- For this repo baseline, run `bun run verify` for feature work (`format` + `lint` + `typecheck` + `test`).
- At minimum, run `bun run typecheck` when TypeScript code changes.
- Document validation that could not run and why.

## Testing

- Add tests for meaningful regression risk or critical behavior.
- Avoid redundant or trivial tests.

## Documentation

- Update docs when behavior or contracts change.
- Keep `docs/project-plan.md` and `docs/talk-notes.md` updated continuously as implementation evolves.
- For autonomous feature implementation, use the repo skill `skills/autonomous-feature-delivery/SKILL.md`.
- Keep this file policy-only. Procedural workflows can be added later as reusable skills.

## Safety

- Never run destructive git/file operations unless explicitly requested.
- Do not discard unrelated changes without approval.
- If unexpected changes appear, pause and confirm before continuing.

## Communication

- Ask when requirements are unclear.
- Capture decisions, tradeoffs, and open questions.
- Be explicit about assumptions, risks, and next steps.
- Prioritize user-focused output: show what helps the user make decisions, not internal implementation noise.
- Prefer concise, readable UX and response formats that surface outcomes, changed files, and actionable next steps.
- Treat picker options as direct actions. Use action-oriented labels and descriptions that clearly state what will happen when selected.
