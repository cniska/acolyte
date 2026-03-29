# Configuration

Configuration is loaded from user scope and project scope, with project values overriding user values.

Paths:
- User: `~/.acolyte/config.toml`
- Project: `<cwd>/.acolyte/config.toml`

## Common commands

```bash
acolyte config list
acolyte config set model gpt-5-mini
acolyte config set locale en
acolyte config set --project logFormat json
acolyte config unset openaiBaseUrl
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
- Locale catalogs are loaded from `src/i18n/locales/*.json` at startup, with `en` fallback.

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

## All settable keys

| Key | Description |
|---|---|
| `port` | daemon server port (default: 6767) |
| `locale` | UI language (default: `en`) |
| `model` | model |
| `temperature` | generation temperature (`0.0` to `2.0`) |
| `openaiBaseUrl` | OpenAI API base URL |
| `anthropicBaseUrl` | Anthropic API base URL |
| `googleBaseUrl` | Google AI API base URL |
| `logFormat` | log output format (`logfmt` or `json`) |
| `embeddingModel` | embedding model for semantic recall |
