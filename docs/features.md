# Acolyte Features

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
- `/status` now keeps local and remote output shapes aligned (local mode includes role-model rows too).
- Local-mode `/status` now also includes `providers` + `provider_ready` lane rows for parity with remote diagnostics.
- `/status` provider now distinguishes `openai` vs `openai-compatible` (based on API base URL), improving local endpoint clarity.
- `/status` formats multi-value fields in stacked `key: value` rows (`models`, `om`, `om_tokens`, `om_state`) and hides duplicate `mode` when `provider` is present.
- `/status` now suppresses duplicate top-level `model` when it matches `models.main`.
- `/status` now includes per-role provider and readiness rows (`providers`, `provider_ready`) for mixed-lane diagnostics.
- `/status` model rows now omit provider prefixes for readability; provider details remain in `providers`.
- Policy distillation command from chat logs: `/distill [--sessions N] [--min N]`.
- Distilled policy candidate review picker with explicit `yes/no` confirmation and optional note (`yes also do this`).
- Skills picker + command support: `/skills` and `$` shortcut.
- Memory commands in chat: `/remember [--project] <text>`, `/memory` (alias: `/mem`).
- OM admin safety: `om:wipe` requires explicit `--yes` confirmation.
- Automatic memory-context injection from saved user/project memories.
- Mastra Studio agent memory with observational memory enabled (resource scope).
- Backend chat passes session/thread identity to Mastra memory for turn continuity while observational memory remains resource-scoped.
- Per-role model overrides with fallback-to-main (`modelPlanner|modelCoder|modelReviewer` -> `~/.acolyte/config.toml` `model`).
- Subagent v1 routing (`planner` / `coder` / `reviewer`) with explicit per-role context handoff.
- Coder role guidance now prefers one clear next action and avoids lettered option menus unless explicitly requested.
- Role guidance now also discourages recap/status/capability scaffolding to keep replies direct.
- Runtime provider is inferred from configured role model IDs (for example `anthropic/...`, `gemini/...`), with credential-aware fallback to mock mode when unavailable.
- Runtime provider inference also recognizes common unprefixed ids (`claude-*`, `gemini-*`) to reduce configuration friction.
- Mastra Studio exposes role agents (`Planner`, `Coder`, `Reviewer`) plus default `acolyte` alias.
- Mastra Studio role agents use role-scoped tools (planner/reviewer read-only: read/search/git/web, coder full toolset).
- `mastra:dev` and `studio` load `.env` automatically for consistent provider credentials in local dev.
- Tool execution errors are normalized with tool-id context (for example `read-file failed: ...`) for clearer debugging.
- Dogfooding workflow command: `/dogfood <task>` with verify-first loop.
- Optional skip verify flow: `/dogfood --no-verify <task>`.
- Assistant output post-processing strips common option-menu/status scaffolding and keeps concise actionable content.
- Automated dogfood smoke checks via `bun run dogfood:smoke`.
- Internal telemetry: one-command dogfood readiness gate via `bun run dogfood:gate` (smoke + delivery-slice progress, optional verify).
- Internal telemetry: gate delivery details now include scoped/scanned commit counts to make lookback diagnostics explicit.
- Internal telemetry: dogfood progress supports machine-readable output (`bun run dogfood:progress --json`).
- Dogfood lookback now scopes to the last N non-doc commits to reduce false negatives from docs-only streaks.
- Biome recommended lint rules enabled in main config (`biome.json`) with zero current diagnostics.
- CLI policy distillation script: `bun run policy:distill --sessions <N> --min <N>`.
- In-flight turn interrupt via `Esc` while Acolyte is thinking.
- One-shot CLI mode via `run` (including `--file` attachment support).
- One-shot `run` mode is isolated (does not reuse/persist chat session history).
- One-shot memory resource isolation for `run`/`dogfood` (`run-<session>` resource ids).
- One-shot `run` exits non-zero on backend failures so scripting/automation can reliably detect errors.
- One-shot `run --verify` propagates verify failures via non-zero exit status.
- Internal tool command surface for search/web/fetch/read/edit/git/run operations.
- Secure-by-default tool guardrails:
  - file reads/edits are restricted to the workspace plus `~/.acolyte`
  - shell commands reject path traversal and paths outside workspace/`~/.acolyte`
- Permission modes (`permissionMode` in `~/.acolyte/config.toml`):
  - `read` (default): disables write-capable tools (shell execution, file edit)
  - `write`: enables full local tool capability within guarded roots
- Read-mode write confirmation picker:
  - likely write prompts trigger `switch/cancel` confirmation with inline `reason…`
  - selecting `switch` sets backend permission mode to `write` and pre-fills the original prompt
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
