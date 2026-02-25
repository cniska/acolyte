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
- Build first, tune second: prioritize delivering a working end-to-end capability before spending time on polish.
- Polish user-facing behavior first in MVP; defer internal polish/refactors unless they unblock delivery, reliability, or safety.
- Apply extra scrutiny to chat-feature changes (input loop, rendering, commands, pickers): require clear UX intent, regression tests for key paths, and a quick smoke run before commit.
- Add long-lived features by default; avoid short-lived/temporary feature surface unless required to unblock immediate progress.
- Follow YAGNI strictly: do not add new commands/features/options unless they are needed for active workflows right now.
- Apply Rule of Three for abstractions: wait for repeated concrete use (roughly three real cases) before introducing shared abstractions.
- Avoid unnecessary indirection and abstractions.
- Prefer prompt/tool-contract improvements over adding host-side task-classification logic.
- Keep host-side autonomy logic minimal; enforce deterministic invariants (file/tool outcomes) instead of brittle output phrasing.
- Prefer root-cause fixes over workaround-only patches.
- Do not add technical debt unless explicitly agreed with the user and tracked with `TODO(username):` plus a docs note.
- Remove temporary debug code before review/commit.

## Validation

- Run relevant validation after changes.
- For this repo baseline, run `bun run verify` for feature work (`format` + `lint` + `typecheck` + `test`).
- At minimum, run `bun run typecheck` when TypeScript code changes.
- Prefer automated smoke checks for readiness; ask for manual user testing only at milestone checkpoints.
- Document validation that could not run and why.

## Testing

- Add tests for meaningful regression risk or critical behavior.
- Avoid redundant or trivial tests.

## Documentation

- Update docs when behavior or contracts change.
- Keep `docs/project-plan.md` and `docs/talk-notes.md` updated continuously as implementation evolves.
- For autonomous feature implementation, use the repo skill `skills/dogfood/SKILL.md`.
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
- Do not generate prompts that require the user to resubmit a prefilled action; execute the selected action directly in the same flow.
- When an automatic action is taken (mode switch, memory save, etc.), always emit a concise assistant confirmation of what changed.
