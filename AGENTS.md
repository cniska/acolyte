# Project Rules

## Architecture

Acolyte is a terminal-first AI coding agent: local-first, observable, extensible. Read `docs/architecture.md` before working on unfamiliar subsystems.

Extension points:
- New lifecycle effect → `Effect` in `lifecycle-effects.ts`, add to `POST_EFFECTS` or `PRE_EFFECTS`
- New tool → appropriate `*-toolkit.ts`; all tools flow through `runTool`
- New ecosystem → `EcosystemDetector` in `workspace-detectors.ts`, add to `ECOSYSTEM_DETECTORS`

## Invariants

These must always hold. Break them and the system breaks.

1. All tools go through `runTool` in `tool-execution.ts` — never call a tool function directly.
2. Every RPC payload, model response, and config value is validated through Zod before entering the type system.
3. A turn completes on the native `end_turn` contract: the model ends its turn by emitting a step with no tool calls, and that step's text is the final response. The only completion backstop is the empty-answer gate (a no-tool-call step with blank text is rejected once, then errors).
4. TUI state updaters must use functional form (`setState(prev => ...)`) when reading current state — stale closure reads cause race conditions.
5. Error handling must follow `docs/errors.md`.
6. Run `bun run verify` before every commit.

## Workflow

1. Default to autonomous execution. Pause only when a decision is ambiguous, risky, or irreversible.
2. When behavior and tests diverge: fix the implementation. Update expectations only if explicitly requested.
3. Commit only when explicitly requested.
4. Do a branch's work in its own git worktree so parallel branches never clobber each other's tree. Create one with `wt <branch>` (makes the branch + worktree under `.claude/worktrees/<branch>`, runs `scripts/worktree-setup.sh`, opens a tmux window); `wt ls` lists, `cd "$(wt path <branch>)"` enters, `wt rm <branch>` removes after merge. Keep the primary `main` checkout for direct-to-`main` changes only.

## Commits

Format: `type(scope): description` — types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`. Single-line subject, no body, under 72 characters. ASCII only. No issue references or links in the subject (`(#123)`, `Fixes #123`) — issue references belong in the PR body.

## Pull requests

- Gate: run `/review` (multi-dimension, not `/code-review`) before opening, and fix all findings first.
- Title: `type(scope): description`, under 50 characters, no trailing period.
- Body follows `.github/pull_request_template.md`: brief motivation (omit when obvious), then a flat summary bullet list. Cut anything a reviewer would infer from the diff — mechanical steps, refactors and deletions in service of the change, test moves, renames.
- End with `Fixes #N` when an issue matches the work.
- Fold related changes into one PR; keep genuinely unrelated work separate.
- Never push or open a PR without explicit approval.

## Code

- No transitional architecture: land the canonical owner, normalized contract, and single source of truth.
- When defining a string union or shared type: define it as a Zod schema first and infer the TS type from it.
- Comments: code documents itself. Don't comment *what* code does and don't write banner/separator comments; add one only for a *why* that can't be encoded in a name, type, or test (e.g. a non-obvious external constraint).
- Import from the canonical source module directly — no re-export layers.
- No direct `useEffect` in chat-layer code. Use the approved effect helpers from `src/tui/effects.ts`.

## Style

- Factory naming: `create*` for factories. Avoid `build*` / `make*` unless established locally.
- Export shape: prefer direct `export const` over local alias + `export { ... }`.
- Module layout: flat `src/`, `*-contract` for type/schema modules.
- Error classification: prefer `kind` field contracts over message string matching.
- Switch exhaustiveness: `default` + `unreachable` when applicable.

## Docs

- One H1 per doc (page title). H1 title case, H2+ sentence case.
- `docs/features.md` discipline: shipped features only, one line, user-visible wording.

## Testing

- Unit: `bun run test:unit`, integration: `bun run test:int`, visual: `bun run test:tui`.
- Unit tests should be pure: mock boundary effects (filesystem, subprocesses, network) instead of exercising them directly.
- If a test needs real filesystem/process/network behavior, put it in `*.int.test.ts` (not `*.test.ts`).
- Integration tests use real server/lifecycle/tool wiring with fake provider model calls.
- Visual tests cover stable TUI rendering and interaction snapshots.
