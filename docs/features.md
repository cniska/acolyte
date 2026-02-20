# Acolyte Features

Canonical source of truth for implemented, in-progress, and planned capabilities.

## Implemented

- CLI-first chat experience with inline prompt, shortcuts panel (`?`), and session-aware context.
- Lightweight semantic response highlighting (inline code, command keywords, and file references).
- Session controls: `/new`, `/sessions`, `/resume <session-id-prefix>`, `/exit`.
- File and directory references via `@path` with suggestions/autocomplete.
- In-chat utility commands: `/status`, `/changes`.
- Skills picker + command support: `/skills` and `$` shortcut.
- Memory commands in chat: `/remember [--project] <text>`, `/memories`.
- Dogfooding workflow command: `/dogfood <task>` with verify-first loop.
- Optional skip verify flow: `/dogfood --no-verify <task>`.
- One-shot CLI mode via `run` (including `--file` attachment support).
- Tool command surface for search/read/edit/git/run operations.
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
- Expanded picker/autocomplete UX for slash commands and additional in-chat controls.
- Optional multi-agent topology after single-agent reliability gates are stable.
- Optional high-signal git hooks (for example pre-push verify) after workflow fit is validated.

## Notes

- For roadmap and sequencing, see `docs/project-plan.md`.
- For speaker/demo context, see `docs/talk-notes.md`.
