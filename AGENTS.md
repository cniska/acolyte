# Project Rules

## Architecture

Acolyte is a terminal-first AI coding agent: local-first, observable, extensible. Read `docs/architecture.md` before working on unfamiliar subsystems.

Extension points:
- New post-generation behavior → `Evaluator` in `lifecycle-evaluators.ts`, add to `EVALUATORS`, declare `modes`
- New lifecycle-owned side effect → `Effect` in `lifecycle-effects.ts`, add to `EFFECTS`, declare `modes`
- New tool guard → `ToolGuard` in `tool-guards.ts`, add to `GUARDS`, declare `modes`
- New tool → appropriate `*-toolkit.ts`; all tools flow through `runTool`
- New ecosystem → `EcosystemDetector` in `workspace-detectors.ts`, add to `ECOSYSTEM_DETECTORS`

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

## Commits

1. Commit only when explicitly requested.
2. Format: `type(scope): description` — types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
3. Single-line subject, no body, under 72 characters. ASCII only — no arrows, symbols, or emoji.
4. Never amend commits already pushed to remote — create a new commit instead.
5. Branch names use hyphens, no slashes (e.g. `di-pattern`, not `refactor/di-pattern`).

## Code

- No transitional architecture: land the canonical owner, normalized contract, and single source of truth.
- When defining a string union or shared type: define it as a Zod schema first and infer the TS type from it.
- No banner or separator comments. Import from the canonical source module directly — no re-export layers.
- No direct `useEffect` in chat-layer code. Use the approved effect helpers from `src/tui/effects.ts`.

## Safety

1. Never run destructive git or file operations unless explicitly requested.
2. Never amend commits already pushed to remote — create a new commit instead.
3. Use `--force-with-lease` over `--force`.
4. Do not discard unrelated changes without approval.
