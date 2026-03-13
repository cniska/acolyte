# Project Rules

## Project Context

Acolyte is a language-agnostic, terminal-first AI coding assistant: local-first, observable, and built for extension. See `docs/architecture.md` for full architecture.

Key files:
- `src/lifecycle.ts` — request lifecycle orchestrator (resolve → prepare → generate → evaluate → finalize)
- `src/lifecycle-resolve.ts`, `src/lifecycle-prepare.ts`, `src/lifecycle-generate.ts`, `src/lifecycle-evaluate.ts`, `src/lifecycle-finalize.ts` — individual lifecycle phases
- `src/lifecycle-evaluators.ts` — `Evaluator` type and evaluator implementations
- `src/agent-modes.ts` — mode definitions (work/verify), mode classification
- `src/file-toolkit.ts`, `src/shell-toolkit.ts`, `src/web-toolkit.ts`, `src/git-toolkit.ts` — tool definitions by domain
- `src/tool-registry.ts` — toolkit registration, permission filtering, `toolsForAgent()`
- `src/tool-execution.ts` — `runTool` (pre-execution guards + post-execution recording)
- `src/tool-guards.ts` — session-level guards (no-rewrite, verify-ran)
- `src/memory-registry.ts` — memory source resolution and registry
- `src/memory-pipeline.ts` — memory normalization, selection, and budget pipeline
- `src/server-http.ts` — HTTP route handlers (`/healthz`, `/v1/status`, `/v1/chat/stream`)
- `src/server-app.ts` — server bootstrap, auth, WebSocket upgrade

Patterns to follow:
- New post-generation behavior → implement `Evaluator` in `lifecycle-evaluators.ts`, add to `EVALUATORS` array
- New tool guard → implement `ToolGuard` in `tool-guards.ts`, add to `GUARDS` array
- New tool → add to the appropriate `*-toolkit.ts` file; all tools go through `runTool` in `tool-execution.ts`
- Feature branch review → run `/review` skill (runs style, arch, and security audits against branch diff)

Development:
- Validate: `bun run verify` (format + lint + typecheck + test)

## Tooling

- Prefer repository scripts and task runners over ad-hoc commands.
- Use documented commands when available.
- Do not depend on external CLI tools (e.g. `rg`, `fd`, `fzf`). Use Bun-native APIs and Node built-ins so the project runs with zero host dependencies beyond Bun itself.
- `scripts/` contains test infrastructure (`fake-provider-server.ts`, `wait-server.ts`) and debugging tools (`lifecycle-trace.ts` for filtering daemon logs by task/request ID).

## Workflow

- Start from latest `main` before new work.
- Read relevant files before editing.
- Keep changes scoped, minimal, and well-engineered.
- Do not edit out-of-scope files without explicit approval.
- Preserve established local intent (code/tests/docs) unless explicitly asked to change it.
- Prefer editing existing files over creating new ones unless necessary.
- Do not guess; use concrete evidence (errors, logs, tests, source) before changing code.
- Respect contract-first development: if behavior and expectations diverge, change implementation unless expectation changes are explicitly requested.
- Avoid incidental rewrites: fix the requested problem without opportunistic restyling/refactors.
- Stop and ask if unexpected diffs or artifacts appear.
- If execution drifts, pause, restate constraints, and continue in small verified steps.
- Default to autonomous execution for straightforward improvements and continue without explicit confirmation.
- Only pause for confirmation when decisions are ambiguous, risky, or irreversible.

## Docs

- Keep docs short, conceptual, and resistant to drift.
- Avoid repeating the same content across `README.md` and `docs/*`; prefer linking to a single canonical doc.
- When behavior/config/contracts change, update the relevant canonical doc in the same work slice.
- `docs/features.md` is an append-only shipped-feature inventory:
  - add entries only when a feature is actually shipped
  - keep entries one line and user-visible
  - avoid implementation details

## Commits

- Commit only when explicitly requested.
- Use Conventional Commit format: `type(scope): description`.
- Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- Single-line subject only — no message body.
- Keep commit subject lines under 72 characters.
- Merge to main via pull request — do not merge branches directly.
- Pull request titles follow the same Conventional Commit format as commit subjects.
- Keep PR summaries concise — short bullet points, no prose.

## Code

- Pragmatic solutions, low maintenance overhead. Build first, tune second.
- YAGNI: no speculative features, commands, or abstractions. Rule of Three before abstracting.
- SRP: each function/module should have one reason to change. When a function mixes concerns (e.g. persistence + display), split it.
- Prefer root-cause fixes over workarounds. No tech debt without explicit agreement and `TODO(username):`.
- Prefer prompt/tool-contract improvements over host-side task-classification logic.
- Extra scrutiny on chat-feature changes: clear UX intent, regression tests, smoke run.
- Prefer interface-first seams at subsystem boundaries (client transport, lifecycle policy, guards, tools).
- Keep behavior behind stable contracts so new transports/integrations are additive, not rewrites.
- Prefer Zod schema definitions as the single source of truth for string unions and infer TS types from schemas.
- No banner or separator comments; let code structure speak for itself.

## Validation

- Run relevant validation after changes.
- Keep the branch green after each fix slice: run the narrowest relevant checks while iterating, then run the required gate before committing.
- For this repo baseline, run `bun run verify` as the final gate before committing (`format` + `lint` + `typecheck` + `test`).
- While iterating, run the narrowest check: `bun run typecheck` for type changes, `bun run lint` for style, `bun test <file>` for specific tests.
- Do not commit on red. If baseline is already red, first land a dedicated fix slice that restores green, then continue feature work.
- Prefer automated smoke checks for readiness; ask for manual user testing only at milestone checkpoints.
- Document validation that could not run and why.

## Testing

- Add tests for meaningful regression risk or critical behavior.
- Avoid redundant or trivial tests.
- Runtime behavior is the source of truth; when tests and runtime disagree, correct the tests unless a real runtime bug is proven.
- Never add test-only branches, flags, mocks, or behavior changes to runtime/production code.

## Safety

- Never run destructive git/file operations unless explicitly requested.
- Do not discard unrelated changes without approval.
- If unexpected changes appear, pause and confirm before continuing.
- Never revert commits — drop them (`git reset`) if not pushed; only revert as a last resort.

## Communication

- Ask when requirements are unclear. Be explicit about assumptions and next steps.
- Prioritize user-focused output: outcomes, changed files, actionable next steps.

## Skills

- Full skill support is required.
- When a task matches a skill, load and follow that skill workflow.
- Prefer skill-provided scripts/templates/assets over re-implementing from scratch.
- Keep skill usage lightweight: load only what is needed for the current task.
