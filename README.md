# Acolyte

Personal AI coding assistant (CLI-first), built on Bun + Mastra.

## Quickstart

```bash
bun install
bun link
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`, then run:

```bash
bun run dev
```

That starts backend watch mode and chat.

## Daily Use

- Start app: `bun run start`
- Chat (backend already running): `acolyte`
- Resume session: `acolyte resume <session-id-prefix>`
- One-shot prompt: `bun run run "review src/agent.ts"`
- Verify: `bun run verify`
- Status: `bun run src/cli.ts status`

## Common In-Chat Commands

- `?` shortcuts
- `@path` attach files/directories
- `/new`, `/sessions`, `/resume <id-prefix>`
- `/status`, `/permissions`
- `/remember [--project] <text>`, `/memory` (aliases: `/rem`, `/mem`)
- `/skills`

## Optional Local Postgres

```bash
bun run db:up
bun run db:smoke
```

## Config Notes

- Non-secret local config: `~/.acolyte/config.toml`
- Secrets are env-only (`OPENAI_API_KEY`, `ACOLYTE_API_KEY`, provider keys)
- Provider/model routing supports role lanes with fallback

## Docs

- Features: `docs/features.md`
- Plan: `docs/project-plan.md`
- Development workflow: `docs/development-workflow.md`
- Talk notes: `docs/talk-notes.md`
- Agent policy: `AGENTS.md`
