# Features

What's currently supported.

## Core CLI

- Interactive chat with Ink-based UI, inline prompt, shortcuts panel (`?`).
- Session management: `/new`, `/sessions`, `/resume <id-prefix>`, `/exit`.
- File and directory references via `@path` with suggestions/autocomplete.
- Slash commands with arrow navigation, Tab/Enter autocomplete, and typo recovery.
- Prompt history (up/down) restored from session messages.
- In-flight turn interrupt via `Esc`.

## Agent & Tools

- Single-agent execution with direct tool usage.
- Tool surface: search, read, write, edit, delete, git status/diff, run command, web search/fetch.
- Permission modes: `read` (default, disables writes) and `write` (full local tool capability).
- Read-mode write confirmation picker with inline reason entry.
- Workspace + `/tmp` path guardrails on all file operations.
- Shell commands reject path traversal outside guarded roots.

## Memory

- Saved memory with user and project scopes (`/remember [--project] <text>`).
- Memory inspection (`/memory`), context view (`/memory context`), and removal (`/memory rm <id-prefix>`).
- Automatic memory-context injection into prompts.
- Observational memory (OM) via Mastra, resource-scoped.

## Configuration

- Layered config precedence: project (`.acolyte/config.toml`) > user (`~/.acolyte/config.toml`) > defaults.
- Secrets are env-only (API keys never in config files).
- Provider inference from model ID (`anthropic/...`, `gemini/...`, `claude-*`, `gemini-*`).
- Configurable token budgets with hard max caps.

## Diagnostics

- `/status` with provider, model, memory, and OM details.
- `/tokens` with per-turn token usage and budget warnings.
- `/sessions` for session listing.

## Run Mode

- `acolyte run "prompt"` for single requests outside interactive chat.
- File attachment support (`--file`), verify mode (`--verify`), configurable timeout.

## Current Limitations

- **Single bounded tasks only.** Cannot autonomously chain multi-step workflows (plan -> edit -> verify -> iterate on failures).
- **No task chaining.** If an edit breaks something, the assistant cannot self-correct without human intervention.
- **Memory quality is early.** Observational memory is wired up but not tuned.
- **Provider coverage is untested.** Real behavior across providers is not validated.
