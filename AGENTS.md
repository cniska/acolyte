# Project Rules

## Project Context

Acolyte is an AI coding assistant: CLI + HTTP server + Mastra agent. See `docs/architecture.md` for full architecture.

Key files:
- `src/agent-lifecycle.ts` — request lifecycle: phases (classify → prepare → generate → evaluate → finalize) + evaluators
- `src/agent.ts` — `runAgent()` entry point (delegates to lifecycle), input/output helpers
- `src/agent-modes.ts` — mode definitions (plan/work/verify), mode classification
- `src/mastra-tools.ts` — tool factories, `guardedExecute`, `toolsForAgent()`
- `src/agent-tools.ts` — tool implementations (edit, read, search, etc.)
- `src/tool-guards.ts` — session-level guards (no-rewrite, verify-ran)
- `src/app-config.ts` — configuration and token budgets
- `docs/soul.md` — assistant personality and behavior contract

Patterns to follow:
- New post-generation behavior → implement `Evaluator` in `agent-lifecycle.ts`, add to evaluator array
- New tool guard → implement `ToolGuard` in `tool-guards.ts`, add to `GUARDS` array
- New tool → add factory in `mastra-tools.ts` with `guardedExecute`, add to `createToolset`
- All tools go through `guardedExecute` (pre-execution guards + post-execution recording)

Development:
- Validate: `bun run verify` (format + lint + typecheck + test)
- Start server: `bun run src/server.ts > /tmp/acolyte-server.log 2>&1 &`
- Restart after code changes: `kill $(lsof -t -i :6767); bun run src/server.ts > /tmp/acolyte-server.log 2>&1 &`
- Run a prompt: `bun run src/cli.ts run '<prompt>' 2>&1`
- Dogfood: run prompts against the playground project, check tool count, verify passes, no shell fallbacks
- Dump current instructions: `bun -e 'import { createModeInstructions } from "./src/agent.ts"; for (const m of ["plan","work","verify"]) { console.log(`\n=== ${m.toUpperCase()} ===`); console.log(createModeInstructions(m)); }'`

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
- Prefer explicit `if`/`switch` branching over nested ternaries for readability in production code.
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
