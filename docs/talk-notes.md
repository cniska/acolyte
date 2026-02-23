# Acolyte Talk Notes

## Purpose
Living notes for talks about building Acolyte. Update this file as milestones ship so demos and explanations stay accurate.

## Project Pitch
- Acolyte is a personal AI coding assistant focused on practical execution:
  - CLI-first UX
  - persistent memory
  - agentic coding workflows
  - explicit behavior contract in `docs/soul.md`

## Moat Narrative
- Reliability moat: fewer repeated mistakes via a verify-first execution loop.
- Memory moat: persistent, user-correctable memory that outlives single sessions.
- Workflow moat: coding-native tools and repo-grounded behavior, not generic assistant output.
- UX moat: operator-focused CLI ergonomics with minimal noise and strong control.
- Safety moat: permission modes + path guardrails by default.

## Architecture Snapshot (2026-02-21)
- CLI runtime: Bun + TypeScript (`src/cli.ts`)
- Backend API: Bun server (`src/server.ts`)
- Agent runtime: Mastra (`src/agent.ts`)
- Tools: repo search/read/git/run/edit + web search/fetch (`src/mastra-tools.ts`)
- Local persistence:
  - sessions: `~/.acolyte/sessions.json`
  - user memory notes: `~/.acolyte/memory/user/*.md`
  - project memory notes: `<repo>/.acolyte/memory/project/*.md`
  - config: `~/.acolyte/config.toml` (+ optional `<repo>/.acolyte/config.toml`)

## Why This Stack
- Bun: fast local iteration and simple CLI/backend workflow.
- Mastra: standardized agent/tool primitives to avoid framework drift.
- Deployable contract: CLI can target local or hosted API without changing user workflow.

## Build Process
- Built collaboratively with Codex in commit-sized slices.
- Delivery loop: define slice -> implement -> validate -> commit.
- Standard validation: `bun run verify`.

## Shipped Highlights
1. Core platform: CLI + backend + Mastra agent/tools + `docs/soul.md`.
2. Local persistence: sessions + memory (user/project) + config.
3. Core commands: search/read/edit/run/git/status, `/verify`.
4. Chat UX: Ink-based interface, stable prompt/transcript separation, shortcuts/pickers, resume/skills flows.
5. Memory UX: `/remember [--project]`, `/memory`, policy distillation groundwork.
6. Developer ergonomics: `@path` attach (files + directories), fuzzy matching, better keybindings, interrupt with `Esc`.
7. Reliability/safety: verify-first loop, role-scoped subagent tools, permission modes, workspace path guardrails.
8. Routing/config: centralized provider/model config with per-role fallback support.
9. Feature documentation: `docs/features.md` as inventory.
10. Dogfooding readiness: automated `bun run dogfood:smoke` + isolated one-shot OM resource IDs for `run`/`dogfood`.
11. Script maintainability: complex `package.json` shell flows moved into reusable `scripts/*.sh` wrappers.

## Demo Flow (Short)
1. Start backend: `bun --env-file=.env run serve`
2. Set CLI backend once: `bun run src/cli.ts config set apiUrl http://localhost:6767`
3. Start chat: `bun run start`
4. Show:
   - `@src/agent.ts review this file`
   - `/remember [--project] ...` and `/memory`
   - `/resume` and `/skills`
   - tool-backed reasoning over attached file context

## Key Talking Points
- Interactive-first CLI beats dashboard-first UX for coding workflows.
- Persistent memory quality matters more than model swapping.
- Standardizing on Mastra early reduces long-term maintenance cost.
- Soul/behavior docs reduce style drift and improve consistency.
- Build process matters: small validated slices outperform large speculative changes.

## Lessons Learned
- Reliability beats novelty: verify-first loops and small commits prevent drift.
- Memory must be transparent and editable, otherwise trust decays quickly.
- UX details matter: prompt ergonomics and low-noise output have outsized impact.
- `@file` references are only valuable when they attach real context, not just visual autocomplete.
- Subagents work better when each role gets explicit context (goal, scope, expected output), not implicit routing guesses.
- Centralized provider/model routing reduces drift across CLI/backend/agent wiring.
- Mock-path smoke checks (`/healthz` with `--no-env-file`) catch provider/env assumptions early.
- Token budget discipline is required during rapid iteration.
- One-shot workflows need memory isolation (`run-<session>` resources) to avoid cross-task bleed.
- Lightweight smoke commands improve confidence without adding heavy CI complexity.
- Moving complex shell orchestration out of `package.json` keeps runtime scripts readable and easier to debug.
- Manual split mode is now explicit: run backend with `bun run serve:env`, then attach CLI with `bun run src/cli.ts`.
- Default startup is managed chat (`bun run start`) for fewer local setup misses.
- Reduced prompt-specific output rewrites (for example greetings) in favor of generic response handling.
- Continued reducing brittle output filtering so assistant replies preserve more model intent.
- Dogfood readiness gate now surfaces clearer first-signal failure lines (less shell-wrapper noise).
- Gate progress parsing failures now include the first actionable signal line for faster troubleshooting.
- Soul prompt now explicitly favors one recommended next action over option menus unless alternatives are requested.
- Internal CLI helpers now use Zod-backed argument validation in key scripts (`dogfood-gate`, `wait-backend`).
- Expanded Zod arg-validation pattern to additional admin tooling (`om-admin`) for consistency.
- `om-soak` now has strict Zod-backed option parsing + tests (and no side-effects on module import).
- Policy distillation option parsing now uses Zod while preserving current CLI error messages.
- Core CLI argument paths (`run`, `edit`) also moved to Zod-backed parsing for consistency.
- `dogfood-progress` now runs `git log` via argv (no shell string construction), reducing injection/quoting risk.
- `dogfood-gate` now executes readiness checks via argv (`bun run ...`) instead of `bash -lc`.
- `dogfood-smoke` checks now run via argv commands as well, removing shell-wrapper execution there too.
- CLI parsing for tool outputs (`exit_code`, `/edit` metadata) now uses Zod validation for safer handling.
- Verify-summary run-meta parsing also moved to Zod (`chat-formatters`) with fallback-safe output.
- `/edit` tool metadata parsing is now strict and Zod-validated (`path`, `matches`, `dry_run`).
- `dogfood-gate` progress JSON is now parsed via an explicit Zod schema (not ad-hoc field checks).
- `policy-distill` option parsing is now strict on unknown flags/missing values (`--sessions`, `--min` only), with explicit errors.
- Session UX was aligned: `/sessions` now renders as a compact assistant block and uses UTF-8 active markers (`●`) for readability.
- Added a forgiving slash alias: `/session` now resolves to `/sessions`.
- Added production-style session resume flow: top-level `acolyte resume [id-prefix]` and an exit-time resume hint command.
- Kept user slash-command surface minimal by moving tool-like commands (`/changes`, `/web`, `/fetch`) out of chat UX and retaining them only as internal agent/debug paths.
- `/status` nested sections now use stacked `key: value` rows for easier scanning during backend/debug checks.
- `/status` nested sections now also align nested keys (for example `main/planner/coder/reviewer`) to improve scan speed.
- Biome recommended lint rules are now enabled in the main config (`biome.json`) with zero current diagnostics.
- Config token budgeting now has hard caps (context/message/attachment/pinned + OM thresholds) to prevent runaway values.
- Permission default is now `read` mode, reducing accidental write/shell actions in fresh sessions.
- Dogfood CLI argument parsing now explicitly supports `--no-verify`, preventing smoke/gate regressions.
- Prompt key handling now parses more modifier-based CSI arrow variants, reducing terminal-specific `Cmd` navigation misses.
- Health/status now labels non-OpenAI base URLs as `openai-compatible`, improving local-model endpoint debugging.
- Role model IDs now drive runtime provider selection (`openai` / `anthropic` / `gemini` / `openai-compatible`) with credential-aware fallback behavior.
- Provider inference now also handles common unprefixed ids (`claude-*`, `gemini-*`) for easier lane setup.
- Terminal key handling now covers more `Cmd`-style Home/End sequence variants across terminal profiles.
- Policy confirmation picker outcomes now stay in assistant voice for consistent transcript tone.
- Status diagnostics now include role-level provider readiness (`main/planner/coder/reviewer`) to debug mixed-provider setup quickly.
- Status model labels are now provider-less for cleaner scan (`gpt-5-mini`, `claude-*`, `gemini-*`), with providers shown separately.
- Non-secret user config is now TOML-readable (`~/.acolyte/config.toml`) while keeping JSON compatibility.
- Secret handling tightened: API keys are env-only; file config no longer accepts/stores `apiKey`.
- Non-secret runtime settings were consolidated into config files (secrets remain env-only), reducing env/config overlap.
- Config precedence is now project-first: `<repo>/.acolyte/config.toml` overrides `~/.acolyte/config.toml`.
- `acolyte config` now supports listing/setting/unsetting all non-secret keys (not just `model`/`apiUrl`).
- Status model rows now render mixed-role providers correctly (no single-provider formatting assumption).
- Coder role instructions now bias toward one recommended next action instead of A/B/C option menus by default.
- Role guidance now explicitly suppresses recap/status/capability scaffolding unless the user asks for it.
- Added `/memory context` to inspect the exact top memory notes currently injected into prompts.
- Memory context selection is now globally time-sorted across user/project scopes.
- `/status` now reports `memory_context` count for at-a-glance prompt-memory transparency.
- Non-chat CLI now supports `acolyte memory context` for scriptable memory-context inspection.
- `/tokens` now surfaces the latest budget warning so context-trim events are visible on demand.
- Memory-context inspection now supports scope filters (`all|user|project`) in both chat (`/memory context <scope>`) and CLI (`acolyte memory context <scope>`).
- Token budget diagnostics moved to on-demand `/tokens` output (removed inline transcript warning rows).
- `/tokens` now shows the latest session warning (not only last-turn warning) to preserve recent trim signal.
- Local `/status` now degrades gracefully if memory-context files are unreadable (status still returns).
- Planner tool scope now matches real planning needs while staying read-only (`read/search/git/web`).
- `mastra:dev` and `studio` now load `.env` so provider credentials are consistent in local dev and Mastra Studio.
- Local backend `/status` now emits role-model fields, matching remote status shape for easier debugging.
- Local backend `/status` now also emits provider lane diagnostics (`providers`, `provider_ready`) for full parity.
- Dogfood progress/gate lookback now evaluates the last N non-doc commits, reducing docs-only noise in readiness checks.
- Dogfood gate delivery diagnostics now surface `scoped` and `scanned` commit counts for clearer readiness debugging.
- Latest dogfood skip-verify gate on February 22, 2026 remained `ready` at 6/6 delivery slices (lookback 10).
- Assistant output cleanup now also strips recap lead-ins that use an em dash (`Recap — ...`) to reduce scaffold leakage.
- `om:soak` now supports `--help` and common camelCase flag aliases (`--delayMs`, `--checkpointEvery`, `--sessionId`, `--wipeBefore`) for smoother local diagnostics.
- Resume hints now fall back to `bun run src/cli.ts resume ...` when `acolyte` is not available on PATH, reducing setup friction on fresh machines.
- CLI memory mode now rejects extra positional args for `memory list/context` (no silent argument drops).
- Slash suggestions now complete memory context scopes (`/memory context all|user|project`) and also work when starting from `/mem context ...`.
- Chat `/memory` now accepts optional scope (`/memory user|project|all`) for parity with CLI memory listing.
- Slash suggestions now also complete `/memory` listing scopes (`/memory all|user|project`) and include `/memory context`.
- Scoped memory headers in chat are now humanized (`User memory`, `Project memory context`) instead of inverted wording.
- Internal dogfood scripts now support `--help` (`dogfood:progress`, `dogfood:gate`) for discoverable local usage.
- OM admin commands now support `--help`/`-h` (`om:status`, `om:wipe`) without triggering unknown-argument errors.
- Dogfood gate delivery detail now includes `remaining=<n>` so near-miss readiness states are explicit at a glance.
- Dogfood smoke now includes a scoped memory check (`acolyte memory context all`) to keep memory UX in the readiness loop.
- Mastra Studio `/api/agents` model metadata can currently show `gpt-5-mini` for all agents even when runtime role routing uses configured models; treat `/status` + runtime traces as source of truth until fixed.
- Added explicit alias regression coverage for scoped memory slash forms (`/mem user|project|context user`).
- Simplified chat memory usage guidance to a two-form usage line: `/memory [scope] | /memory context [scope]`.
- Added regression coverage for project-scoped chat memory header output (`/memory project` -> `Project memory ...`).
- Instruction quality beats brittle cleanup code: role/soul prompts are now the primary lever for concise, user-focused answers.
- MVP focus tightened to reliability over polish: prioritize successful tool-backed execution and explicit failure signals over response post-processing.
- Keep post-processing minimal and defensive only (empty-output fallbacks, safety/error clarity), not style-shaping.
- Agent finalization now preserves raw model output (trim-only + empty-output fallback), removing most style-shaping rewrite logic.
- Direct edit prompts now enforce an execution contract: no successful completion unless `edit-file` actually ran.
- Write-confirm recovery now auto-replays the original prompt via an internal payload, avoiding a second manual submit after switching to write mode.
- Empty-output fallback is now more specific when tools ran but no final answer was produced, improving troubleshooting signal.

## Open Narrative Threads
1. Continue dogfooding ramp from Codex-led to Acolyte-led development.
2. Improve memory promotion/retrieval quality and transparency.
3. Complete hosted readiness (Postgres/pgvector + backup/restore + auth hardening).
4. Add lane-based model routing and local-model support.
5. Refine transcript/tool output for maximal signal with minimal noise.
