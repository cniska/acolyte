# Features

Canonical source of truth for what works, what doesn't, and what's planned.

## What Works

### Core CLI
- Interactive chat with Ink-based UI, inline prompt, shortcuts panel (`?`).
- Session management: `/new`, `/sessions`, `/resume <id-prefix>`, `/exit`.
- File and directory references via `@path` with suggestions/autocomplete.
- Slash commands with arrow navigation, Tab/Enter autocomplete, and typo recovery.
- Prompt history (up/down) restored from session messages.
- In-flight turn interrupt via `Esc`.
- Compact slash aliases (`/df`, `/mem`, `/rem`).

### Agent & Tools
- Single-agent execution with direct tool usage.
- Tool surface: search, read, write, edit, delete, git status/diff, run command, web search/fetch.
- Permission modes: `read` (default, disables writes) and `write` (full local tool capability).
- Read-mode write confirmation picker with inline reason entry.
- Workspace + `/tmp` path guardrails on all file operations.
- Shell commands reject path traversal outside guarded roots.
- Tool execution errors normalized with tool-id context.
- Truncated tool output keeps leading + trailing context with omitted-lines marker.

### Memory
- Saved memory with user and project scopes (`/remember [--project] <text>`).
- Memory inspection (`/memory [all|user|project]`), context view (`/memory context`), and removal (`/memory rm <id-prefix>`).
- Automatic memory-context injection into prompts.
- Observational memory (OM) via Mastra, resource-scoped.
- Memory layers are separate and independently inspectable.

### Configuration
- Layered config precedence: project (`.acolyte/config.toml`) > user (`~/.acolyte/config.toml`) > defaults.
- Secrets are env-only (API keys never in config files).
- Provider inference from model ID (`anthropic/...`, `gemini/...`, `claude-*`, `gemini-*`).
- Configurable token budgets with hard max caps.

### Diagnostics
- `/status` with provider/model details, provider readiness, memory context count.
- `/tokens` with per-turn model-call counts, token usage, and budget warnings.
- `/sessions` for session listing.
- All diagnostic output is system-scoped and scan-friendly.

### One-Shot Mode
- `bun run run "prompt"` for single requests (isolated, no session persistence).
- File attachment support (`--file`), verify mode (`--verify`), configurable timeout.
- Non-zero exit on failures for scripting/automation.

### Dogfooding Infrastructure
- Automated smoke checks (`bun run dogfood:smoke`).
- Progress tracking (`bun run dogfood:progress`).
- Readiness gate (`bun run dogfood:gate`).
- Policy distillation from chat logs (`/distill`).
- Skills system (`/skills`) for reusable workflow templates.

## Current Limitations

- **Single bounded tasks only.** The assistant can create a script or fix a type error, but cannot autonomously chain multi-step workflows (plan -> edit -> verify -> iterate on failures).
- **No task chaining.** If an edit breaks something, the assistant cannot self-correct without human intervention.
- **Memory quality is early.** Observational memory is wired up but not tuned. No evals for measuring improvement.
- **Provider coverage is untested.** Integration testing uses mocks only. Real behavior across OpenAI, Anthropic, and Google providers is not validated.
- **No multi-agent or multi-model routing.** Single agent, single model. Complex tasks that benefit from specialized models are not supported.

## In Progress

- Closing the autonomous execution loop (Milestone 5).
- Memory quality tuning (Milestone 6).
- Stabilizing streaming and tool-output rendering.

## Planned

- Complex multi-file task execution.
- Iterative autonomous execution (plan -> edit -> verify -> iterate).
- Hosted mode for centralized memory across devices.
- Persistent memory evolution with safeguards.
- Friends-and-family distribution and feedback.
- Public OSS release.

## Notes

- For roadmap and sequencing, see `docs/project-plan.md`.
- For speaker/demo context, see `docs/talk-notes.md`.
