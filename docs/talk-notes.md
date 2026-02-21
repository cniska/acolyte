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
  - config: `~/.acolyte/config.json`

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
- Biome recommended lint rules are now enabled in the main config (`biome.json`) with zero current diagnostics.
- Env token budgeting now has hard caps (context/message/attachment/pinned + OM thresholds) to prevent runaway config values.
- Permission default is now `read` mode, reducing accidental write/shell actions in fresh sessions.
- Dogfood CLI argument parsing now explicitly supports `--no-verify`, preventing smoke/gate regressions.
- Prompt key handling now parses more modifier-based CSI arrow variants, reducing terminal-specific `Cmd` navigation misses.
- Health/status now labels non-OpenAI base URLs as `openai-compatible`, improving local-model endpoint debugging.
- Role model IDs now drive runtime provider selection (`openai` / `anthropic` / `gemini` / `openai-compatible`) with credential-aware fallback behavior.
- Provider inference now also handles common unprefixed ids (`claude-*`, `gemini-*`) for easier lane setup.
- Status model rows now render mixed-role providers correctly (no single-provider formatting assumption).
- Coder role instructions now bias toward one recommended next action instead of A/B/C option menus by default.

## Open Narrative Threads
1. Continue dogfooding ramp from Codex-led to Acolyte-led development.
2. Improve memory promotion/retrieval quality and transparency.
3. Complete hosted readiness (Postgres/pgvector + backup/restore + auth hardening).
4. Add lane-based model routing and local-model support.
5. Refine transcript/tool output for maximal signal with minimal noise.
