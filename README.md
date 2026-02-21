# Acolyte

Personal AI coding assistant (CLI-first), built on Bun + Mastra.

## Tech Stack

- Runtime: Bun + TypeScript
- Agent runtime: Mastra (`@mastra/core`, `@mastra/memory`, `@mastra/pg`)
- Models/providers: OpenAI-compatible APIs (default: OpenAI)
- CLI UI: Ink + `ink-text-input`
- Storage:
  - Local-first: JSON + markdown memory files under `~/.acolyte` / `<repo>/.acolyte`
  - Optional DB: Postgres + pgvector (via Docker/Vercel Postgres)
- Quality tooling: Biome (format + lint), TypeScript, Bun test

## Quickstart (Local-First)

1. Install deps:
```bash
bun install
```

2. Link the CLI command (recommended):
```bash
bun link
```

This makes `acolyte` available in your shell (for example `acolyte --help` and `acolyte resume <id>`).

3. Create `.env`:
```bash
cp .env.example .env
```

At minimum, set `OPENAI_API_KEY` in `.env`.
Role model vars are optional and fall back to `ACOLYTE_MODEL`.
Use provider-qualified model IDs for non-OpenAI lanes (for example `anthropic/claude-sonnet-4`, `gemini/gemini-2.5-pro`).
Unprefixed `claude-*` and `gemini-*` ids are auto-inferred to Anthropic/Gemini providers for convenience.

4. Start full dev mode (recommended):
```bash
bun run dev
```

This runs the backend in watch mode and opens chat.

5. Optional manual split mode:
```bash
bun run serve:env
```

Then start chat in another shell:
```bash
ACOLYTE_API_URL=http://localhost:6767 bun run src/cli.ts
```

## Daily Commands

- Dev (backend watch + chat): `bun run dev`
- Chat only (assumes backend already running): `acolyte`
- Start (starts backend helper process): `bun run start`
- Resume session: `acolyte resume <session-id-prefix>`
- Help / version: `acolyte --help`, `acolyte --version`
- One-shot prompt (isolated session): `bun run run "review src/agent.ts"`
- Dogfood prompt (verify-first): `bun run dogfood "fix src/agent.ts"`
- Dogfood prompt (skip verify): `bun run dogfood --no-verify "ping"`
- Dogfood smoke checks: `bun run dogfood:smoke`
- Status: `bun run src/cli.ts status`
- Verify: `bun run verify`
- Mastra Studio: `bun run studio`
- Policy distillation from chat logs: `bun run policy:distill --sessions 60 --min 2`

## In-Chat Shortcuts

- `?` toggle shortcuts
- `@path` attach file/dir context
- `/new`, `/sessions`, `/resume <id-prefix>`
- `/status`, `/permissions`
- `/dogfood <task>` (alias: `/df`)
- `/distill [--sessions N] [--min N]`
- `/remember [--project] <text>`, `/memory` (aliases: `/rem`, `/mem`)
- `/skills`

## Optional Postgres

```bash
bun run db:up
bun run db:smoke
bun run om:status
bun run om:wipe -- --yes
bun run om:soak --turns 60 --checkpoint-every 10
```

## Notes

- Hosted mode is planned, not implemented.
- No deployment is required for local-first usage.
- `bun run verify` runs: `format + lint + typecheck + test`.
- Switch-to-Acolyte path: use small commit-sized slices, run `bun run verify`, then run `bun run dogfood:smoke`.
- Internal dogfood telemetry (`dogfood:progress`, `dogfood:gate`) is documented in `docs/development-workflow.md`.
- Complex script orchestration is centralized in `scripts/` (`with-backend.sh`, `with-mastra-dev.sh`).

## More Docs

- Features: `docs/features.md`
- Roadmap/plan: `docs/project-plan.md`
- Talk notes: `docs/talk-notes.md`
- Agent policy: `AGENTS.md`
