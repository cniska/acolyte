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

- Non-secret runtime defaults come from config files with precedence:
  - project: `<repo>/.acolyte/config.toml`
  - user: `~/.acolyte/config.toml`
- Config CLI writes user scope by default; use `--project` for repo scope:
  - `acolyte config set --project model "anthropic/claude-sonnet-4"`
  - `acolyte config list --user`
- Use `acolyte config set model <value>` and `acolyte config set apiUrl <url>` to update them
- Secrets are env-only (`OPENAI_API_KEY`, `ACOLYTE_API_KEY`, provider keys)
- Provider/model routing supports role lanes with fallback

Example `~/.acolyte/config.toml`:

```toml
port = 6767
model = "gpt-5-mini"
modelPlanner = "o3"
modelCoder = "gpt-5-codex"
modelReviewer = "gpt-5-mini"
apiUrl = "http://localhost:6767"
openaiBaseUrl = "https://api.openai.com/v1"
anthropicBaseUrl = "https://api.anthropic.com"
permissionMode = "read"
logFormat = "logfmt"
contextMaxTokens = 8000
maxHistoryMessages = 40
maxMessageTokens = 600
maxAttachmentMessageTokens = 3000
maxPinnedMessageTokens = 1200
omObservationTokens = 3000
omReflectionTokens = 8000
```

## Docs

- Features: `docs/features.md`
- Plan: `docs/project-plan.md`
- Development workflow: `docs/development-workflow.md`
- Talk notes: `docs/talk-notes.md`
- Agent policy: `AGENTS.md`
