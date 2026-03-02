# Acolyte

![Acolyte logo](src/assets/acolyte.png)

Acolyte is the coding agent you want to work with every day: fast, predictable, and trustworthy.

## Core Principles

- One primary UX: chat-first workflow with predictable behavior.
- Execution policy is explicit: lifecycle + guards + evaluators, not prompt-only heuristics.
- Safety-first by default: guardrails and bounded autonomy over risky shortcuts.
- Output contracts matter: stable, test-backed CLI/TUI output and minimal noise.
- Build for extension: stable seams now, plugin runtime later.

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
- Start/reuse local daemon server: `acolyte server start`
- Local server status: `acolyte server status`
- Stop local daemon server: `acolyte server stop`
- If status shows `unmanaged`, server was started outside Acolyte; stop it manually.
- If local daemon target changes, Acolyte replaces the previous managed local server.
- Managed daemon log: `~/.acolyte/server.log`
- Resume session: `acolyte resume <session-id-prefix>`
- Run mode (auto-starts/reuses local server when using local defaults): `acolyte run "review src/agent.ts"`
- Verify: `bun run verify`
- Status: `acolyte status`
- Lifecycle trace: `bun run trace:lifecycle` (defaults to `~/.acolyte/server.log`; use `--log <path>` to override)
- Mastra Studio: `bun run studio` (loads `.env` automatically)
- RPC transport: set `transportMode = "rpc"` in config (or use `ws://` `apiUrl`)

## Debug

- Debug logs: set `ACOLYTE_DEBUG=<tag[,tag2|prefix*]>` when needed.

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
