# Configuration

Configuration is loaded from user scope and project scope, with project values overriding user values.

Paths (see [Paths](paths.md) for platform-specific details):
- User: config dir + `config.toml`
- Project: `<cwd>/.acolyte/config.toml`

## Common commands

```bash
acolyte config list
acolyte config set model gpt-5-mini
acolyte config set locale en
acolyte config set --project logFormat json
acolyte config unset openaiBaseUrl
```

## Vercel AI Gateway (recommended)

The fastest way to get started. The [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) provides unified access to 20+ providers with a single API key.

```bash
acolyte init vercel
acolyte config set model anthropic/claude-sonnet-4
```

When a direct provider key is also set (e.g. `ANTHROPIC_API_KEY`), Acolyte prefers the direct connection. When it's missing, requests fall back to the gateway automatically — no prefix or config change needed.

```bash
# Explicitly target a provider only available through the gateway
acolyte config set model vercel/xai/grok-4.1

# Override the gateway base URL
acolyte config set vercelBaseUrl https://custom-gateway.example.com/v1
```

## Provider base URLs

Each provider has a configurable base URL with a sensible default:

- `openaiBaseUrl`: OpenAI API base (default: `https://api.openai.com/v1`). Set to a local endpoint for OpenAI-compatible providers (Ollama, vLLM, etc.).
- `anthropicBaseUrl`: Anthropic API base (default: `https://api.anthropic.com/v1`). Must end with `/v1`.
- `googleBaseUrl`: Google AI API base (default: `https://generativelanguage.googleapis.com`).

## Local models

Configure an OpenAI-compatible local endpoint directly in project config, then set the model explicitly:

```bash
acolyte config set --project openaiBaseUrl http://localhost:11434/v1
ollama pull <model>
acolyte config set --project model openai-compatible/<model>
```

## Localization

- `locale`: active UI language (defaults to `en`).
- English messages are defined in `src/i18n/en.ts`. Additional locales are loaded from `src/i18n/locales/*.json` at startup.

## Logging

- `logFormat`: log output format (`logfmt` | `json`, default: `logfmt`).

`logfmt` emits one `key=value` line per entry:

```
2026-03-20T12:00:00.000Z level=info msg="request started" model=gpt-5-mini
```

`json` emits one JSON object per line with typed fields:

```json
{"ts":"2026-03-20T12:00:00.000Z","level":"info","msg":"request started","model":"gpt-5-mini"}
```

```bash
acolyte config set logFormat json
```

## MCP servers

Connect Acolyte to external services (Figma, Jira, Notion, Chrome DevTools, etc.) via MCP servers. Configure servers in `mcp.json` — project-level config takes precedence over user-level by server name.

Paths:
- User: config dir + `mcp.json`
- Project: `<cwd>/.acolyte/mcp.json`

Two transports are supported:
- `stdio` — server runs as a local subprocess (`command`, `args`, optional `env`). Only a minimal set of environment variables is forwarded to the subprocess (`PATH`, `HOME`, `SHELL`, `TERM`, `USER`, `LANG`, `LC_ALL`, `TMPDIR`, `XDG_RUNTIME_DIR`) plus any explicitly configured in `env`.
- `http` — server is reachable over HTTPS (`url`, optional `headers`). Non-HTTPS URLs are allowed for localhost (`127.0.0.1`, `::1`) but blocked for remote hosts.

Each server's tools appear in the agent alongside native tools. If a server is unreachable at task start it is skipped with a warning and the lifecycle continues.

## Feature flags

Feature flags are opt-in toggles for experimental behavior, configured under `[features]` in `config.toml`.

Enable via TOML:

```toml
[features]
syncAgents = true
```

Enable via CLI:

```bash
acolyte config set features.syncAgents true
```

### Available flags

| Flag | Description |
|------|-------------|
| `syncAgents` | Sync `AGENTS.md` into a deterministic project memory record (`mem_agentsmd`). The model recalls it via `memory-search` instead of prompt injection. |
| `undoCheckpoints` | Write tools create undo checkpoints under `.acolyte/undo/<sessionId>/`. The model can list and restore via `undo-list` and `undo-restore`. |
| `parallelWorkspaces` | Enable `/workspaces` chat commands for managing git worktrees and workspace-scoped sessions. |
| `cloudSync` | Use the cloud API for memory and session storage. Requires `acolyte login`. |

## All settable keys

| Key | Description |
|---|---|
| `port` | daemon server port (default: 6767) |
| `locale` | UI language (default: `en`) |
| `model` | model |
| `temperature` | generation temperature (`0.0` to `2.0`) |
| `reasoning` | reasoning level for supported models (`low`, `medium`, `high`) |
| `openaiBaseUrl` | OpenAI API base URL |
| `anthropicBaseUrl` | Anthropic API base URL |
| `googleBaseUrl` | Google AI API base URL |
| `vercelBaseUrl` | Vercel AI Gateway base URL |
| `logFormat` | log output format (`logfmt` or `json`) |
| `embeddingModel` | embedding model for semantic recall |
| `distillModel` | model used for memory distillation |
| `replyTimeoutMs` | max reply wait time in ms (min 1000, default 180000) |
| `features.syncAgents` | opt-in: sync `AGENTS.md` to project memory and omit it from prompt |
| `features.undoCheckpoints` | opt-in: capture write-tool undo checkpoints |
| `features.parallelWorkspaces` | opt-in: enable `/workspaces` chat commands |
| `features.cloudSync` | opt-in: use cloud API for memory and session storage |
