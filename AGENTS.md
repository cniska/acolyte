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
- Verify every factual claim at its source before it ships, and cite it — `file:line` for code, a pinned revision for anything outside the repo. Inference, memory, and a plausible reading of a name are not verification.
- A quantifier (`only`, `never`, `every`, `no other`) needs an exhaustive sweep, not a sample. Without one, weaken the claim to what was checked.
- Commit verified slices locally on the topic branch as you go; never commit unrequested on `main`.
- Changes that affect agent behavior: dogfood with `acolyte run` before merge, not just tests.

## Workflow

- Run: `bun run start` (dev with watch/restart: `bun run dev`).
- Verify before pushing or opening a PR: `bun run verify` (lint, typecheck, test, audit). A slice commit runs the tests covering the slice.
- Release: `bun run release <patch|minor|major>` — the script owns the gates (clean `main`, version bump, changelog, verify, tag).
- Worktrees: do each branch's work in its own worktree so parallel branches never clobber the tree; `wt <branch>` creates one (`scripts/worktree-setup.sh`), `wt rm <branch>` removes it. Keep the primary `main` checkout for direct-to-`main` changes.

## Commits

Format: `type(scope): description` — types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`. Single-line subject, no body, under 72 characters, ASCII only. No issue references or links in the subject (`(#123)`, `Fixes #123`) — those belong in the PR body. Commits must be signed (SSH signing, repo-wide `commit.gpgsign`). Author and committer must be a real identity: the pre-push hook rejects reserved placeholder domains (`example.com`, `.invalid`, `.test`, `localhost`).

## Pull requests

- Open a PR for anything behavior-affecting, release-gating, or touching a load-bearing subsystem (memory, lifecycle, renderer, transcript); push direct to `main` only for releases and changes that alter no behavior (typos, comments, dead-code removal, pure refactors that keep `verify` green). Size is a tiebreaker, not the test.
- Gate: run the multi-dimension `review` skill (not `code-review`) before opening, and fix all findings first.
- Title: `type(scope): description`, under 50 characters, no trailing period.
- Body follows `.github/pull_request_template.md`: brief motivation (omit when obvious), then a flat summary bullet list. Cut anything a reviewer would infer from the diff.
- End with `Fixes #N` when an issue matches the work.
- Fold related changes into one PR; keep unrelated work separate.
- Never push or open a PR without explicit approval.
- Merges are squash-only; the PR title becomes the squash commit subject, so it must satisfy the commit format above. `main` is protected against force-pushes and deletions, requires linear history and signed commits, and the pre-push hook enforces commit format and author identity.

## Code

- No transitional architecture: land the canonical owner, normalized contract, and single source of truth.
- Define string unions and shared types as a Zod schema first; infer the TS type from it.
- Import from the canonical source module directly — no re-export layers.
- No direct `useEffect` in chat-layer code — use the approved helpers in `src/tui/effects.ts`.
- Comments: add one only for a *why* that can't be encoded in a name, type, or test; never comment *what* the code does, and no banner/separator comments.
- Every model-facing prompt is Acolyte speaking, in the register of [docs/soul.md](docs/soul.md): first person, short declaratives, no hedging. State the shape you want rather than enumerating what is forbidden, keep the tool contract plain and separate from that framing, and cut any line that does not change what the model does.

## Style

- Biome is the formatter and linter of record: 2-space indent, 120-column lines.
- `create*` for factories; avoid `build*`/`make*` unless established locally.
- Prefer direct `export const` over a local alias plus `export { ... }`.
- Flat `src/`; `*-contract` for type/schema modules.
- Classify errors by a `kind` field, not by matching message strings.
- Exhaustive switches: `default` + `unreachable` when applicable.

## Docs

- Docs live in `docs/`. One H1 per doc (page title); H1 title case, H2+ sentence case.
- Never hard-wrap Markdown paragraphs or bullets.
- Bullets: a full sentence is capitalized and takes a period; a noun-phrase fragment stays lowercase and unpunctuated, unless it opens with an acronym or proper noun.
- The first sentence is the SEO description consumed by [acolyte.sh](https://acolyte.sh); make it a single plain-text, 80–180-character summary of the page.
- Start each doc with a one-sentence summary and organize it around reader questions; use headings, short paragraphs, tables, or diagrams to break dense material.
- State the contract, not the reasoning behind it: cut any sentence a reader does not need in order to use the thing, and match the detail level of the sibling sections around it.
- Before completing a docs change, read it against the affected code and adjacent canonical docs; update terminology and user-facing surfaces everywhere they are documented.
- `docs/features.md`: shipped features only, one line each, user-visible wording.

## Testing

- Layout: unit `*.test.ts`, integration `*.int.test.ts`. Run: unit `bun run test:unit`, integration `bun run test:int`, visual `bun run test:tui`.
- Unit tests are pure: mock the application's boundary effects (filesystem, subprocess, network) instead of exercising them.
- A test needing real filesystem/process/network behavior goes in `*.int.test.ts`, never `*.test.ts`. The exception is a `scripts/` shell script, whose subject under test *is* the process: run it directly from a `*.test.ts` beside it.
- Integration tests use real server/lifecycle/tool wiring with a fake provider for model calls.
- A test that shells out to `git` builds its environment with `gitEnv` from `test-utils.ts`: an inherited `GIT_DIR` retargets the fixture's commands at this repository.
- Visual tests snapshot stable TUI rendering and interaction.
