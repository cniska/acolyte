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

2. Create `.env`:
```bash
OPENAI_API_KEY=...
# Optional:
# ACOLYTE_MODEL=gpt-5-mini
# ACOLYTE_MODEL_PLANNER=o3
# ACOLYTE_MODEL_CODER=gpt-5-codex
# ACOLYTE_MODEL_REVIEWER=gpt-5-mini
# DATABASE_URL=postgres://acolyte:acolyte@localhost:5432/acolyte
# ACOLYTE_PERMISSION_MODE=write   # read|write
# ACOLYTE_CONTEXT_MAX_TOKENS=8000
# ACOLYTE_MAX_HISTORY_MESSAGES=40
# ACOLYTE_MAX_MESSAGE_TOKENS=600
# ACOLYTE_MAX_ATTACHMENT_MESSAGE_TOKENS=3000
# ACOLYTE_MAX_PINNED_MESSAGE_TOKENS=1200
# ACOLYTE_LOG_FORMAT=logfmt       # logfmt|json
```

Role model vars are optional and fall back to `ACOLYTE_MODEL`.

3. Start full dev mode (recommended):
```bash
bun run dev
```

This runs the backend in watch mode and opens chat.

4. Optional manual split mode:
```bash
bun run serve:env
```

Then start chat in another shell:
```bash
ACOLYTE_API_URL=http://localhost:6767 bun run chat:raw
```

## Daily Commands

- Dev (backend watch + chat): `bun run dev`
- Chat only (assumes backend already running): `bun run chat:raw`
- Chat (starts backend helper process): `bun run chat`
- One-shot prompt (isolated session): `bun run run "review src/agent.ts"`
- Dogfood prompt (verify-first): `bun run dogfood "fix src/agent.ts"`
- Dogfood smoke checks: `bun run dogfood:smoke`
- Dogfood smoke (auto-start backend): `bun run dogfood:smoke:env`
- Status: `bun run status`
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
