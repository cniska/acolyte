# Acolyte

Personal AI coding assistant (CLI-first), built on Bun + Mastra.

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
```

Role model vars are optional and fall back to `ACOLYTE_MODEL`.

3. Start backend:
```bash
bun run serve:env
```

4. Start chat (new shell):
```bash
ACOLYTE_API_URL=http://localhost:6767 bun run chat
```

## Daily Commands

- Chat: `bun run chat`
- One-shot prompt: `bun run run "review src/agent.ts"`
- Status: `bun run status`
- Verify: `bun run verify`
- Mastra Studio: `bun run studio`

## In-Chat Shortcuts

- `?` toggle shortcuts
- `@path` attach file/dir context
- `/new`, `/sessions`, `/resume <id-prefix>`
- `/status`, `/changes`
- `/dogfood <task>` (alias: `/df`)
- `/compact <task>` (aliases: `/cmp`, `/df`)
- `/dogfood-status` (alias: `/ds`)
- `/remember [--project] <text>`, `/memory` (aliases: `/rem`, `/mem`)
- `/skills`

## Optional Postgres

```bash
bun run db:up
bun run db:smoke
```

## Notes

- Hosted mode is planned, not implemented.
- No deployment is required for local-first usage.
- `bun run verify` runs: `format + lint + typecheck + test`.

## More Docs

- Features: `docs/features.md`
- Roadmap/plan: `docs/project-plan.md`
- Talk notes: `docs/talk-notes.md`
- Agent policy: `AGENTS.md`
