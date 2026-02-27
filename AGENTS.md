# Project Rules

## Project Context

Acolyte is an AI coding assistant: CLI + HTTP server + Mastra agent. See `docs/architecture.md` for full architecture.

Key files:
- `src/lifecycle.ts` — request lifecycle (classify → prepare → generate → evaluate → finalize)
- `src/agent-modes.ts` — mode definitions (plan/work/verify), mode classification
- `src/mastra-tools.ts` — tool factories, `guardedExecute`, `toolsForAgent()`
- `src/tool-guards.ts` — session-level guards (no-rewrite, verify-ran)

Patterns to follow:
- New post-generation behavior → implement `Evaluator` in `lifecycle.ts`, add to evaluator array
- New tool guard → implement `ToolGuard` in `tool-guards.ts`, add to `GUARDS` array
- New tool → add factory in `mastra-tools.ts` with `guardedExecute`, add to `createToolset`
- All tools go through `guardedExecute` (pre-execution guards + post-execution recording)

Development:
- Validate: `bun run verify` (format + lint + typecheck + test)
- Dogfood: see `skills/dogfood/SKILL.md` for server setup, prompt testing, and iteration workflow

## Tooling

- Prefer repository scripts and task runners over ad-hoc commands.
- Use documented commands when available.
- Do not depend on external CLI tools (e.g. `rg`, `fd`, `fzf`). Use Bun-native APIs and Node built-ins so the project runs with zero host dependencies beyond Bun itself.

## Workflow

- Start from latest `main` before new work.
- Read relevant files before editing.
- Keep changes scoped, minimal, and well-engineered.
- Prefer editing existing files over creating new ones unless necessary.
- Do not guess; use concrete evidence (errors, logs, tests, source) before changing code.
- Stop and ask if unexpected diffs or artifacts appear.
- Default to autonomous execution for straightforward improvements and continue without explicit confirmation.
- Only pause for confirmation when decisions are ambiguous, risky, or irreversible.

## Docs

- Keep docs short, conceptual, and resistant to drift.
- Avoid repeating the same content across `README.md` and `docs/*`; prefer linking to a single canonical doc.
- `docs/features.md` is an append-only shipped-feature inventory:
  - add entries only when a feature is actually shipped
  - keep entries one line and user-visible
  - avoid implementation details

## Commits

- Commit only when explicitly requested.
- Use Conventional Commit format: `type(scope): description`.
- Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- Keep commit subject lines under 72 characters.

## Code

- Pragmatic solutions, low maintenance overhead. Build first, tune second.
- YAGNI: no speculative features, commands, or abstractions. Rule of Three before abstracting.
- Prefer root-cause fixes over workarounds. No tech debt without explicit agreement and `TODO(username):`.
- Prefer prompt/tool-contract improvements over host-side task-classification logic.
- Extra scrutiny on chat-feature changes: clear UX intent, regression tests, smoke run.

## Validation

- Run relevant validation after changes.
- For this repo baseline, run `bun run verify` for feature work (`format` + `lint` + `typecheck` + `test`).
- At minimum, run `bun run typecheck` when TypeScript code changes.
- Prefer automated smoke checks for readiness; ask for manual user testing only at milestone checkpoints.
- Document validation that could not run and why.

## Testing

- Add tests for meaningful regression risk or critical behavior.
- Avoid redundant or trivial tests.

## Safety

- Never run destructive git/file operations unless explicitly requested.
- Do not discard unrelated changes without approval.
- If unexpected changes appear, pause and confirm before continuing.

## Communication

- Ask when requirements are unclear. Be explicit about assumptions and next steps.
- Prioritize user-focused output: outcomes, changed files, actionable next steps.

## Skills

- Full skill support is required.
- When a task matches a skill, load and follow that skill workflow.
- Prefer skill-provided scripts/templates/assets over re-implementing from scratch.
- Keep skill usage lightweight: load only what is needed for the current task.
