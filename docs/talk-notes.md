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
- Tools: repo search/read/git/run/edit + web search (`src/mastra-tools.ts`)
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
3. Core commands: search/read/edit/run/git/status, `/verify`, `/changes`.
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
3. Start chat: `bun run chat`
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
- Manual split mode is now explicit: run backend with `bun run serve:env`, then attach CLI with `bun run chat:raw`.
- Default start entry now uses managed chat startup (`bun run start` -> `bun run chat`) for fewer local setup misses.
- Reduced prompt-specific output rewrites (for example greetings) in favor of generic response handling.
- Continued reducing brittle output filtering so assistant replies preserve more model intent.
- Dogfood readiness gate now surfaces clearer first-signal failure lines (less shell-wrapper noise).
- Gate progress parsing failures now include the first actionable signal line for faster troubleshooting.
- Soul prompt now explicitly favors one recommended next action over option menus unless alternatives are requested.
- Internal CLI helpers now use Zod-backed argument validation in key scripts (`dogfood-gate`, `wait-backend`).
- Expanded Zod arg-validation pattern to additional admin tooling (`om-admin`) for consistency.

## Open Narrative Threads
1. Continue dogfooding ramp from Codex-led to Acolyte-led development.
2. Improve memory promotion/retrieval quality and transparency.
3. Complete hosted readiness (Postgres/pgvector + backup/restore + auth hardening).
4. Add lane-based model routing and local-model support.
5. Refine transcript/tool output for maximal signal with minimal noise.
