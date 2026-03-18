# Project Rules

## Architecture

Acolyte is a terminal-first AI coding assistant: local-first, observable, extensible. Read `docs/architecture.md` before working on unfamiliar subsystems.

Extension points:
- New post-generation behavior → `Evaluator` in `lifecycle-evaluators.ts`, add to `EVALUATORS`
- New tool guard → `ToolGuard` in `tool-guards.ts`, add to `GUARDS`
- New tool → appropriate `*-toolkit.ts`; all tools flow through `runTool`

## Invariants

These must always hold. Break them and the system breaks.

1. All tools go through `runTool` in `tool-execution.ts` — never call a tool function directly.
2. Every RPC payload, model response, and config value is validated through Zod before entering the type system.
3. `@signal` is a suffix — model output must end with exactly one `@signal` line. Strip the signal line and everything after it.
4. TUI state updaters must use functional form (`setState(prev => ...)`) when reading current state — stale closure reads cause race conditions.
5. Run `bun run verify` before every commit.

## Workflow

1. Start from latest `main`.
2. Read relevant files before editing. Use errors, logs, tests, and source as evidence — never guess.
3. Keep changes scoped to the task. Defer out-of-scope work to issues.
4. Clean up code you touch — but don't chase cleanup into unrelated files.
5. Before creating a new file: check whether an existing one is the right place.
6. When behavior and tests diverge: fix the implementation. Update expectations only if explicitly requested.
7. Default to autonomous execution. Pause only when a decision is ambiguous, risky, or irreversible.
8. When unexpected diffs or artifacts appear: stop and confirm before continuing.
9. Ask when intent is unclear. Lead with outcomes, changed files, and next steps — not process.

## Commits

1. Commit only when explicitly requested.
2. Format: `type(scope): description` — types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
3. Single-line subject, no body, under 72 characters. ASCII only — no arrows, symbols, or emoji.
4. Never amend commits already pushed to remote — create a new commit instead.
5. Cut releases only for user-facing features or meaningful bug fixes — not for internal refactors or tooling cleanup alone.
6. PR titles follow the same Conventional Commit format. Summaries: short bullets, no prose.
7. When creating or updating a pull request, read and follow the local PR template if the repo provides one.
8. Branch names use hyphens, no slashes (e.g. `di-pattern`, not `refactor/di-pattern`).

## Code

- Before adding anything new: ask "will this be used right now?" If not, don't add it.
- Before abstracting: find at least three similar cases first.
- When a function mixes concerns (e.g. persistence + display): split it.
- Before finalizing a fix: ask "root cause or symptom?" If symptom, keep digging.
- Before committing non-trivial changes: ask "is there a more elegant solution?"
- No transitional architecture at shared seams: if the proper fix belongs in a different boundary or contract, move it there. Do not stop at a "good enough for this slice" shape; land the canonical owner, normalized contract, and single source of truth before committing.
- If you must leave tech debt: get explicit agreement and mark it `TODO(username):`.
- When choosing between a prompt/tool-contract fix and host-side classification logic: prefer the contract fix.
- Before committing chat-feature changes: UX intent is clear, regression test exists, smoke run passes.
- When adding a subsystem boundary: define the interface first, implement second.
- When defining a string union or shared type: define it as a Zod schema first and infer the TS type from it.
- No banner or separator comments. Import from the canonical source module directly — no re-export layers.

## Validation

1. Never call a task done without proving it works. Run tests, check output, demonstrate correctness.
2. While iterating, run the narrowest check: `bun run typecheck`, `bun run lint`, or `bun test <file>`.
3. Run `bun run verify` as the final gate before committing.
4. Never commit on red. If the baseline is already red: restore green first, then continue.
5. Manual testing only at milestone checkpoints. Document any validation that couldn't run and why.

## Testing

- Before closing a fix: ask "could this regress silently?" If yes, add a test.
- Before adding a test: ask "does this cover behavior that could realistically break?" If not, skip it.
- For unit tests, keep a module's unit coverage in its canonical `<module>.test.ts` file. Split into separate test files only for distinct subsystems or intentionally separate surfaces.
- When a test and runtime disagree: fix the test unless a real runtime bug is proven.
- Never add test-only branches, flags, mocks, or behavior changes to runtime code.

## Safety

1. Never run destructive git or file operations unless explicitly requested.
2. Never amend commits already pushed to remote — create a new commit instead.
3. Use `--force-with-lease` over `--force`.
4. Do not discard unrelated changes without approval.
5. Never revert commits — drop with `git reset` if not pushed; revert only as a last resort.
