# Project Rules

[SPEC.md](SPEC.md) is the source of truth for requirements (what, not how) — read it before changing behavior, and keep it current in the same change that changes behavior; the spec never lags the code. Invariants may cite spec IDs; code, comments, and test names must not.

## Architecture

Acolyte is a terminal-first AI coding agent: local-first, observable, extensible. Read `docs/architecture.md` before working on unfamiliar subsystems.

Extension seams:
- New lifecycle effect → add an `Effect` in `lifecycle-effects.ts` to `PRE_EFFECTS`/`POST_EFFECTS`.
- New tool → the matching `*-toolkit.ts`.
- New ecosystem → add an `EcosystemDetector` in `workspace-detectors.ts` to `ECOSYSTEM_DETECTORS`.

## Invariants

These must always hold.

1. All tools go through `runTool` in `tool-execution.ts` — never call a tool function directly.
2. Every RPC payload, model response, and config value is validated through Zod before entering the type system.
3. Completion belongs to the model: a no-tool-call step ends the turn and its text is the final response. The host never forces or fabricates completion — its only gate is the terminal-step `finishReason` backstop in `lifecycle-completion.ts` (policy: `docs/lifecycle.md`).
4. TUI state updaters must use functional form (`setState(prev => ...)`) when reading current state — stale closure reads cause races.
5. Error handling follows `docs/errors.md`.

## Execution

- Default to autonomous execution. Pause only when a decision is ambiguous, risky, or irreversible.
- When behavior and tests diverge, fix the implementation. Update expectations only when explicitly requested.
- Commit only when explicitly requested.
- Changes that affect agent behavior: dogfood with `acolyte run` before merge, not just tests.

## Workflow

- Run: `bun run start` (dev with watch/restart: `bun run dev`).
- Verify before every commit: `bun run verify` (lint, typecheck, test, audit).
- Release: `bun run release <patch|minor|major>` — the script owns the gates (clean `main`, version bump, changelog, verify, tag).
- Worktrees: do each branch's work in its own worktree so parallel branches never clobber the tree; `wt <branch>` creates one (`scripts/worktree-setup.sh`), `wt rm <branch>` removes it. Keep the primary `main` checkout for direct-to-`main` changes.

## Commits

Format: `type(scope): description` — types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`. Single-line subject, no body, under 72 characters, ASCII only. No issue references or links in the subject (`(#123)`, `Fixes #123`) — those belong in the PR body.

## Pull requests

- Gate: run `/review` (multi-dimension, not `/code-review`) before opening, and fix all findings first.
- Title: `type(scope): description`, under 50 characters, no trailing period.
- Body follows `.github/pull_request_template.md`: brief motivation (omit when obvious), then a flat summary bullet list. Cut anything a reviewer would infer from the diff.
- End with `Fixes #N` when an issue matches the work.
- Fold related changes into one PR; keep unrelated work separate.
- Never push or open a PR without explicit approval.

## Code

- No transitional architecture: land the canonical owner, normalized contract, and single source of truth.
- Define string unions and shared types as a Zod schema first; infer the TS type from it.
- Import from the canonical source module directly — no re-export layers.
- No direct `useEffect` in chat-layer code — use the approved helpers in `src/tui/effects.ts`.
- Comments: add one only for a *why* that can't be encoded in a name, type, or test; never comment *what* the code does, and no banner/separator comments.

## Style

- Biome is the formatter and linter of record: 2-space indent, 120-column lines.
- `create*` for factories; avoid `build*`/`make*` unless established locally.
- Prefer direct `export const` over a local alias plus `export { ... }`.
- Flat `src/`; `*-contract` for type/schema modules.
- Classify errors by a `kind` field, not by matching message strings.
- Exhaustive switches: `default` + `unreachable` when applicable.

## Docs

- Docs live in `docs/`. One H1 per doc (page title); H1 title case, H2+ sentence case.
- `docs/features.md`: shipped features only, one line each, user-visible wording.

## Testing

- Layout: unit `*.test.ts`, integration `*.int.test.ts`. Run: unit `bun run test:unit`, integration `bun run test:int`, visual `bun run test:tui`.
- Unit tests are pure: mock boundary effects (filesystem, subprocess, network) instead of exercising them.
- A test needing real filesystem/process/network behavior goes in `*.int.test.ts`, never `*.test.ts`.
- Integration tests use real server/lifecycle/tool wiring with a fake provider for model calls.
- Visual tests snapshot stable TUI rendering and interaction.
