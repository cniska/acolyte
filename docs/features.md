# Features

Canonical source of truth for implemented, in-progress, and planned capabilities.

## Implemented

- CLI-first chat experience with inline prompt, shortcuts panel (`?`), and session-aware context.
- Lightweight semantic response highlighting (inline code, command keywords, and file references).
- Session controls: `/new`, `/sessions`, `/resume <session-id-prefix>`, `/exit`.
- File and directory references via `@path` with suggestions/autocomplete.
- Slash-command suggestions with arrow navigation and Tab/Enter autocomplete.
- Unknown slash-command typo recovery (for example `/stauts` -> `/status`).
- Prompt history (up/down) restores from session user messages after restart/resume.
- One-slot prompt queue while thinking (latest submit wins) with inline queued indicator.
- Compact slash aliases for common commands (`/df`, `/mem`, `/rem`).
- In-chat utility commands: `/status`, `/permissions`.
- `/status` includes provider/model details plus API base URL for endpoint diagnostics.
- `/status` now keeps local and remote output shapes aligned with a single-model contract.
- `/status` provider now distinguishes `openai` vs `openai-compatible` (based on API base URL), improving local endpoint clarity.
- `/status` formats multi-value fields in stacked `key: value` rows (`models`, `om`, `om_tokens`, `om_state`) and hides duplicate `mode` when `provider` is present.
- `/status` includes `memory_context` to show how many memory notes are currently injected into prompts.
- Local `/status` remains available even if memory-context files are temporarily unreadable.
- `/status` uses a single-model status contract with compact output.
- `/status` includes provider readiness as a single `provider_ready` field.
- `/status` model rows (including `om.model`) now omit provider prefixes for readability; provider details remain in `providers`.
- Policy distillation command from chat logs: `/distill [--sessions N] [--min N]`.
- `/tokens` now includes the latest token-budget warning when context was trimmed or near budget.
- `/tokens` now keeps the latest session warning visible even if the newest turn has no warning.
- `/tokens` now includes per-turn model-call diagnostics (`last` + `session`) for debugging routing/cost behavior.
- `/tokens` usage now persists per session and restores on `/resume` (resets on `/new`).
- Token-budget warnings are shown on-demand via `/tokens` (not as inline transcript noise).
- Slash command diagnostics are system-scoped for consistency (`/status`, `/sessions`, `/tokens`, memory/permissions/distill flows).
- `/status` command output uses dim keys with normal-value rendering for faster scanning.
- Distilled policy candidate review picker with explicit `yes/no` confirmation and optional note (`yes also do this`).
- Skills picker + command support: `/skills` and `$` shortcut.
- Memory commands in chat: `/remember [--project] <text>`, `/memory [all|user|project]`, `/memory context [all|user|project]` (alias: `/mem`).
- Memory context selection is now globally sorted by timestamp across user/project scopes before injection.
- Non-chat CLI also supports `acolyte memory context [all|user|project]` for scriptable memory-context inspection.
- Saved memory context and observational memory (OM) are separate layers and can be inspected independently (`memory context` vs `om:*` tools/status fields).
- OM admin safety: `om:wipe` requires explicit `--yes` confirmation.
- Automatic memory-context injection from saved user/project memories.
- Mastra Studio agent memory with observational memory enabled (resource scope).
- Backend chat passes session/thread identity to Mastra memory for turn continuity while observational memory remains resource-scoped.
- Single configured model (`model`) is used across the assistant runtime.
- Single-agent execution path with direct tool usage and compact responses.
- Runtime provider is inferred from configured model ID (for example `anthropic/...`, `gemini/...`), with credential-aware fallback to mock mode when unavailable.
- Runtime provider inference also recognizes common unprefixed ids (`claude-*`, `gemini-*`) to reduce configuration friction.
- Mastra Studio exposes a single `acolyte` agent.
- `mastra:dev` and `studio` load `.env` automatically for consistent provider credentials in local dev.
- Tool execution errors are normalized with tool-id context (for example `read-file failed: ...`) for clearer debugging.
- Truncated tool output now keeps both leading and trailing context, with an explicit omitted-lines marker for scan-friendly debugging.
- Dogfooding workflow command: `/dogfood <task>` with verify-first loop.
- Optional skip verify flow: `/dogfood --no-verify <task>`.
- Assistant output post-processing is intentionally minimal (safety/error shaping + empty-output fallback).
- Automated dogfood smoke checks via `bun run dogfood:smoke` (strict autonomy can require provider-ready coding checks).
- Dogfood smoke now requires four real e2e coding edit tasks when provider is ready (including a multi-line structured edit and a multi-file edit), with an explicit skip when provider credentials are not configured.
- Dogfood coding smoke checks fail on fallback edit responses to keep autonomous execution quality explicit.
- Internal telemetry: one-command dogfood readiness gate via `bun run dogfood:gate` (verify, smoke, recovery, diagnostics, concurrency, delivery progress).
- Internal telemetry: gate delivery details now include scoped/scanned commit counts to make lookback diagnostics explicit.
- Internal telemetry: dogfood progress supports machine-readable output (`bun run dogfood:progress --json`).
- Dogfood lookback now scopes to the last N non-doc commits to reduce false negatives from docs-only streaks.
- Biome recommended lint rules enabled in primary config (`biome.json`) with zero current diagnostics.
- CLI policy distillation script: `bun run policy:distill --sessions <N> --min <N>`.
- In-flight turn interrupt via `Esc` while the assistant is thinking.
- One-shot CLI mode via `run` (including `--file` attachment support).
- One-shot `run` mode is isolated (does not reuse/persist chat session history).
- One-shot memory resource isolation for `run`/`dogfood` (`run-<session>` resource ids).
- One-shot `run` exits non-zero on backend failures so scripting/automation can reliably detect errors.
- One-shot `run`/`dogfood` backend reply timeout is configurable via `ACOLYTE_RUN_REPLY_TIMEOUT_MS` (default `120000`).
- One-shot `run --verify` propagates verify failures via non-zero exit status.
- Internal tool command surface for search/web/fetch/read/edit/git/run operations.
- Secure-by-default tool guardrails:
  - file reads/edits are restricted to the workspace plus `/tmp`
  - shell commands reject path traversal and paths outside workspace/`/tmp`
- Permission modes (`permissionMode` in `~/.acolyte/config.toml`):
  - `read` (default): disables write-capable tools (shell execution, file edit)
  - `write`: enables full local tool capability within guarded roots
- Read-mode write confirmation picker:
  - likely write prompts trigger `switch/cancel` confirmation with inline `reason…`
  - selecting `switch` sets backend permission mode to `write` and pre-fills the original prompt
- Clarification handling is picker-first: clarifying-question responses open pickers directly without generated follow-up transcript prompts.
- `dogfood:progress` reports delegated success/failure proxy counts and success rate from recent non-doc commits.
- `dogfood:progress` reports delegated feature/fix slice counts.
- `dogfood:progress` reports non-delivery category counts from scoped commits to track repeated failure classes.
- `dogfood:gate` includes delegated ratio + delegated-slice threshold checks, a stability-window check, and supports `--strict-autonomy` mode for higher thresholds plus provider-ready smoke enforcement.
- Strict autonomy gate also enforces soak durability with ready-run and distinct-day minimums.
- Local backend server with health check (`/healthz`) and chat endpoint (`/v1/chat`).
- User-friendly backend connection errors with direct recovery hints (`bun run dev` or `bun run serve:env`).
- Local-first configuration and optional API-key auth for backend access.
- Non-secret local config now supports layered precedence: project (`<repo>/.acolyte/config.toml`) over user (`~/.acolyte/config.toml`) over defaults.
- File config is now non-secret only: `apiKey` is ignored in config files and `/config set apiKey` is blocked (env-only).
- Configurable agent input budgeting via `~/.acolyte/config.toml`:
  - `contextMaxTokens`
  - `maxHistoryMessages`
  - `maxMessageTokens`
  - `maxAttachmentMessageTokens`
  - `maxPinnedMessageTokens`
- Token budget parsing enforces hard max caps to prevent runaway configs.

## In Progress

- Chat UX consistency polish (formatting, response compactness, command output ergonomics).
- Transition workflow toward assistant-led development (dogfooding ramp on this repo).
- Reliability hardening for command output and review behavior.

## Planned

- Hosted mode for centralized memory across devices.
- Mastra-backed production workflow and deeper integration.
- Persistent memory evolution, including observational memory with safeguards.
- Expanded picker/autocomplete UX for additional in-chat controls.
- Richer multi-step delegation/orchestration beyond current single-agent execution.
- Optional high-signal git hooks (for example pre-push verify) after workflow fit is validated.
- Optional messaging channel adapter (for example WhatsApp via OpenClaw/Twilio) after core reliability and auth hardening.

## Notes

- For roadmap and sequencing, see `docs/project-plan.md`.
- For speaker/demo context, see `docs/talk-notes.md`.
