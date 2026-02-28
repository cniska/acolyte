# Acolyte

![Acolyte logo](src/assets/acolyte.png)

Personal AI coding delegate (CLI-first), built on Bun + Mastra.

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

- Chat (auto-starts/reuses local server): `acolyte`
- Start server in foreground: `acolyte server`
- Local server status: `acolyte server status`
- Stop local daemon server: `acolyte server stop`
- Resume session: `acolyte resume <session-id-prefix>`
- Run mode: `acolyte run "review src/agent.ts"`
- Verify: `bun run verify`
- Status: `bun run src/cli.ts status`
- Mastra Studio: `bun run studio` (loads `.env` automatically)
- RPC transport: set `transportMode = "rpc"` in config (or use `ws://` `apiUrl`)

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

## Minimal Config Example (`~/.acolyte/config.toml`)

```toml
port = 6767
model = "anthropic/claude-sonnet-4"
apiUrl = "http://localhost:6767"
anthropicBaseUrl = "https://api.anthropic.com"
openaiBaseUrl = "https://api.openai.com/v1"
permissionMode = "read"
logFormat = "logfmt"
transportMode = "auto"
contextMaxTokens = 8000
maxHistoryMessages = 40
maxMessageTokens = 600
maxAttachmentMessageTokens = 3000
maxPinnedMessageTokens = 1200
omObservationTokens = 3000
omReflectionTokens = 8000
```

## Docs

- Overview: [`docs/architecture.md`](docs/architecture.md)
- Feature inventory: [`docs/features.md`](docs/features.md)
- Direction and milestones: [`docs/roadmap.md`](docs/roadmap.md)
- Talk prep notes: [`docs/talk-notes.md`](docs/talk-notes.md)
- Agent policy: [`AGENTS.md`](AGENTS.md)
