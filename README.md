# Acolyte

![Acolyte logo](src/assets/acolyte.png)

Personal AI coding assistant (CLI-first), built on Bun + Mastra.

## Quickstart

```bash
bun install
bun link
cp .env.example .env
```

Set at least one provider key in `.env` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`), then run:

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
- Memory context: `acolyte memory context [all|user|project]`
- Mastra Studio: `bun run studio` (loads `.env` automatically)

## Common In-Chat Commands

- `?` shortcuts
- `@path` attach files/directories
- `/new`, `/sessions`, `/resume <id-prefix>`
- `/status`, `/permissions`
- `/remember [--project] <text>`, `/memory [all|user|project]`, `/memory context [all|user|project]` (aliases: `/rem`, `/mem`)
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
- Single configured model is used across the assistant runtime

## Memory Layers

- Saved memory context:
  - Stored in markdown memory files (`user` + `project` scopes).
  - Injected into prompts as "User memory context".
  - Inspect with `acolyte memory context [all|user|project]` or in chat via `/memory context [all|user|project]`.
- Observational memory (OM):
  - Managed by Mastra memory and updated from conversation turns.
  - Reflected in backend status fields such as `om`, `om_state`, and `memory_context`.
  - Inspect with `bun run om:status`; wipe manually only with `bun run om:wipe -- --yes`.

Example `~/.acolyte/config.toml`:

```toml
port = 6767
model = "anthropic/claude-sonnet-4"
apiUrl = "http://localhost:6767"
anthropicBaseUrl = "https://api.anthropic.com"
openaiBaseUrl = "https://api.openai.com/v1"
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
