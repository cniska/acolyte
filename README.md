# Acolyte

![Acolyte logo](src/assets/acolyte.png)

Personal AI coding delegate (CLI-first), built on Bun + Mastra. Handles bounded coding tasks with autonomous plan → work → verify execution.

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

- Start server: `acolyte serve`
- Chat (backend already running): `acolyte`
- Resume session: `acolyte resume <session-id-prefix>`
- Run mode: `acolyte run "review src/agent.ts"`
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
- Dotted keys for nested sections: `acolyte config set models.work gpt-5-mini`
- Secrets are env-only (`OPENAI_API_KEY`, `ACOLYTE_API_KEY`, provider keys)
- Per-mode model overrides via `models.plan`, `models.work`, `models.verify` (falls back to `model`)

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

See [`docs/`](docs/) for project documentation and [`AGENTS.md`](AGENTS.md) for agent policy.
