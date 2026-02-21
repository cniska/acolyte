# Acolyte Features

Canonical source of truth for implemented, in-progress, and planned capabilities.

## Implemented

- CLI-first chat experience with inline prompt, shortcuts panel (`?`), and session-aware context.
- Lightweight semantic response highlighting (inline code, command keywords, and file references).
- Session controls: `/new`, `/sessions`, `/resume <session-id-prefix>`, `/exit`.
- File and directory references via `@path` with suggestions/autocomplete.
- Slash-command suggestions with arrow navigation and Tab/Enter autocomplete.
- Unknown slash-command typo recovery (for example `/stauts` -> `/status`).
- One-slot prompt queue while thinking (latest submit wins) with inline queued indicator.
- Compact slash aliases for common commands (`/df`, `/ds`, `/mem`, `/rem`).
- In-chat utility commands: `/status`, `/permissions`, `/changes`, `/web <query>`.
- Policy distillation command from chat logs: `/distill [--sessions N] [--min N]`.
- Distilled policy candidate review picker with explicit `yes/no` confirmation and optional note (`yes also do this`).
- In-chat dogfooding readiness check: `/dogfood-status` with short alias `/ds`.
- Non-interactive dogfooding readiness command: `acolyte dogfood-status`.
- Skills picker + command support: `/skills` and `$` shortcut.
- Memory commands in chat: `/remember [--project] <text>`, `/memory` (alias: `/mem`).
- Automatic memory-context injection from saved user/project memories.
- Mastra Studio agent memory with observational memory enabled (resource scope).
- Backend chat passes session/thread identity to Mastra memory for turn continuity while observational memory remains resource-scoped.
- Per-role model overrides with fallback-to-main (`ACOLYTE_MODEL_PLANNER|CODER|REVIEWER` -> `ACOLYTE_MODEL`).
- Subagent v1 routing (`planner` / `coder` / `reviewer`) with explicit per-role context handoff.
- Mastra Studio exposes role agents (`Planner`, `Coder`, `Reviewer`) plus default `acolyte` alias.
- Dogfooding workflow command: `/dogfood <task>` with verify-first loop.
- Optional skip verify flow: `/dogfood --no-verify <task>`.
- CLI policy distillation script: `bun run policy:distill --sessions <N> --min <N>`.
- In-flight turn interrupt via `Esc` while Acolyte is thinking.
- One-shot CLI mode via `run` (including `--file` attachment support).
- Tool command surface for search/web/read/edit/git/run operations.
- Secure-by-default tool guardrails:
  - file reads/edits are restricted to the workspace plus `~/.acolyte`
  - shell commands reject path traversal and paths outside workspace/`~/.acolyte`
- Permission modes (`ACOLYTE_PERMISSION_MODE`):
  - `read`: disables write-capable tools (shell execution, file edit)
  - `write`: enables full local tool capability within guarded roots
- Read-mode write confirmation picker:
  - likely write prompts trigger `switch/cancel` confirmation with inline `reason…`
  - selecting `switch` sets backend permission mode to `write` and pre-fills the original prompt
- Local backend server with health check (`/healthz`) and chat endpoint (`/v1/chat`).
- Local-first configuration and optional API-key auth for backend access.

## In Progress

- Chat UX consistency polish (formatting, response compactness, command output ergonomics).
- Transition workflow toward Acolyte-led development (dogfooding ramp on this repo).
- Reliability hardening for command output and review behavior.

## Planned

- Hosted mode for centralized memory across devices.
- Mastra-backed production workflow and deeper integration.
- Persistent memory evolution, including observational memory with safeguards.
- Expanded picker/autocomplete UX for additional in-chat controls.
- Richer multi-step subagent delegation/orchestration beyond v1 role routing.
- Optional high-signal git hooks (for example pre-push verify) after workflow fit is validated.
- Optional messaging channel adapter (for example WhatsApp via OpenClaw/Twilio) after core reliability and auth hardening.

## Notes

- For roadmap and sequencing, see `docs/project-plan.md`.
- For speaker/demo context, see `docs/talk-notes.md`.
