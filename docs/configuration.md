# Configuration

Acolyte merges user and project configuration for models, providers, localization, logging, memory, lifecycle behavior, and feature flags.

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

## Provider auth

`acolyte auth` authenticates providers with an API key or, where supported, a subscription:

```bash
acolyte auth                         # status for every provider
acolyte auth openai                  # interactive: key or subscription
acolyte auth openai --key            # store OPENAI_API_KEY
acolyte auth openai --subscription   # browser OAuth
acolyte auth vercel --key            # store AI_GATEWAY_API_KEY
acolyte auth openai --logout         # remove stored credentials for openai
acolyte auth openai --logout --key   # remove only OPENAI_API_KEY
acolyte auth openai --logout --subscription # remove only the subscription
```

API keys are written to `<configDir>/credentials` (mode 0600), the same file `acolyte login` uses. Subscription tokens are stored separately in `<configDir>/oauth.json`. `auth` asks for confirmation before replacing stored credentials.

Acolyte reads each provider key from the environment first, then the credentials file. Any variable in the process environment — exported in your shell, injected by CI, or loaded from a project `.env` — takes precedence over the stored key.

Providers: `anthropic` (`ANTHROPIC_API_KEY`), `google` (`GOOGLE_API_KEY`), `openai` (`OPENAI_API_KEY`), `vercel` (`AI_GATEWAY_API_KEY`). `acolyte status` and `acolyte auth` list which providers are configured and how they authenticate.

## Vercel AI Gateway (recommended)

The fastest way to get started. The [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) provides unified access to 20+ providers with a single API key.

```bash
acolyte auth vercel --key
acolyte config set model anthropic/claude-sonnet-4
```

When a direct provider key is also set (e.g. `ANTHROPIC_API_KEY`), Acolyte prefers the direct connection. When it's missing, requests fall back to the gateway automatically — no prefix or config change needed.

Acolyte enables AI Gateway automatic prompt caching on gateway requests. For direct Anthropic requests, Acolyte marks stable system and tool prefixes for ephemeral prompt caching. OpenAI-hosted models use stable prompt cache keys when supported, and Google models use provider-side implicit caching when available.

```bash
# Explicitly target a provider only available through the gateway
acolyte config set model vercel/xai/grok-4.1

# Override the gateway base URL
acolyte config set vercelBaseUrl https://custom-gateway.example.com/v1
```

## OpenAI subscription

Authenticate OpenAI with a subscription instead of (or in addition to) an API key:

```bash
acolyte auth openai --subscription
```

This runs a browser OAuth flow (loopback callback on port 1455, required by OpenAI) and stores the tokens in `<configDir>/oauth.json` (mode 0600). Tokens refresh automatically.

The models your subscription serves then route through it. Other OpenAI models fall back to `OPENAI_API_KEY` when one is set, or return an error asking for a key. A subscription and an API key can be active at once — `acolyte status` and `acolyte auth` report the methods in effect — and `acolyte auth openai --logout` removes both the stored key and the subscription for that provider.

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

Connect Acolyte to external services (Figma, Jira, Notion, Chrome DevTools, etc.) via MCP servers. Configure servers under the `mcpServers` key in `.mcp.json` at the project root.

MCP is disabled by default. Enable it explicitly with:

```toml
[features]
mcp = true
```

Only enable MCP in trusted repositories. `.mcp.json` is project-controlled and `stdio` servers execute local commands.

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
| `mcp` | Opt-in: load MCP servers from `.mcp.json` and expose their tools to the agent. |

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
| `features.mcp` | opt-in: enable MCP servers from `.mcp.json` |
