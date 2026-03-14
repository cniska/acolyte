# Configuration

Configuration is loaded from user scope and project scope, with project values overriding user values.

Paths:
- user: `~/.acolyte/config.toml`
- project: `<cwd>/.acolyte/config.toml`

## Common commands

```bash
acolyte config list
acolyte config set model gpt-5-mini
acolyte config set locale en
acolyte config set --project transportMode rpc
acolyte config unset openaiBaseUrl
```

## Provider base URLs

Each provider has a configurable base URL with a sensible default:

- `openaiBaseUrl`: OpenAI API base (default: `https://api.openai.com/v1`). Set to a local endpoint for OpenAI-compatible providers (Ollama, vLLM, etc.).
- `anthropicBaseUrl`: Anthropic API base (default: `https://api.anthropic.com/v1`). Must end with `/v1`.
- `googleBaseUrl`: Google AI API base (default: `https://generativelanguage.googleapis.com`).

## Local models

Use `acolyte init ollama` to write a project-scoped OpenAI-compatible base URL for a local Ollama server.

Then pull a model and set it explicitly:

```bash
ollama pull <model>
acolyte config set --project model openai-compatible/<model>
```

## Localization

- `locale`: active UI language (defaults to `en`).
- Locale catalogs are loaded from `src/i18n/locales/*.json` at startup, with `en` fallback.

## Memory-related keys

- `memoryBudgetTokens`: memory injection budget.
- `memorySources`: Memory Source Strategy IDs and order (see [Memory](./memory.md)).
- `distillModel`: model used by distill source.
- `distillMessageThreshold`: observation trigger threshold.
- `distillReflectionThresholdTokens`: reflection trigger threshold.
- `distillMaxOutputTokens`: output cap for distill records.

## Memory controls

- `memoryBudgetTokens=0` disables memory injection globally.
- `useMemory=false` disables memory injection and commit for one request.

Behavior details: see [Memory](./memory.md).
