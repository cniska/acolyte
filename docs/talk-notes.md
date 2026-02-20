# Acolyte Talk Notes

## Purpose
Living notes for talks about building Acolyte. Update this file as milestones ship so demos and explanations stay accurate.

## Project Pitch
- Acolyte is a personal AI coding assistant with:
  - interactive CLI-first UX
  - centralized memory across devices
  - agentic workflows and coding tools
  - explicit behavior contract in `docs/soul.md`

## Current Architecture (as of 2026-02-20)
- CLI runtime: Bun + TypeScript (`src/cli.ts`)
- Backend API: Bun server with `/v1/chat` and `/healthz` (`src/server.ts`)
- Agent runtime: Mastra `Agent` (`src/agent.ts`)
- Tools: Mastra tools for repo search/read/git/run/edit (`src/mastra-tools.ts`)
- Local persistence:
  - sessions: `~/.acolyte/sessions.json`
  - memory notes: `~/.acolyte/memory.json`
  - config: `~/.acolyte/config.json`

## Why This Stack
- Bun: fast local iteration and simple CLI/backend workflow.
- Mastra: standardized agent/tool primitives to avoid framework drift.
- Hosted-backend-ready contract: CLI can target local or hosted API without changing user workflow.

## Build Process
- Built collaboratively with Codex in commit-sized slices.
- Used an autonomous delivery loop: define slice -> implement -> validate -> commit.
- Standardized validation via `bun run verify` and kept docs/workflow in sync as features shipped.

## Milestones (Condensed)
### 2026-02-20
- Core platform: CLI + backend + Mastra agent/tools + `docs/soul.md`.
- Persistence: local sessions, memory notes, config.
- Coding tools: `search`, `read`, `git-status`, `git-diff`, `run`, `edit`, plus `/verify`.
- UX upgrades:
  - cleaner banner/session flows (`/resume`, session switching)
  - compact action-style tool transcripts (`Run`, `Search`, `Read`, `Diff`, `Update`)
  - inline summaries (search counts, read line count, diff +/- summary)
  - fixed no-result search UX to report `No matches.` cleanly
  - run output now shows command duration (`duration_ms`) with exit code
  - edit summaries now include changed location count and change-only excerpts
  - git status summaries (`N changed files`) before detailed entries
  - repo-relative read paths and reduced successful `Run` noise
  - typo-tolerant command suggestions (`Did you mean ...` / `Try: ...`) for unknown slash commands
  - switched CLI accent color to a lighter accessible royal-purple branding
  - tool headers now use white action labels with dim gray args for readability
  - fixed overflow marker alignment in truncated tool output lists
  - hard-separated chat UX: only `?` and `/exit`; internal commands moved to top-level CLI/tool mode
  - `?` toggles a compact panel under the prompt (`esc` closes); chat starts on a cleared screen
- Delivery workflow:
  - `bun run verify` (`typecheck` + tests)
  - autonomous feature loop in `docs/development-workflow.md`
  - local skill scaffold in `skills/autonomous-feature-delivery/SKILL.md`

## Demo Flow (Short)
1. Start backend: `bun --env-file=.env run serve`
2. Set CLI backend once: `bun run src/cli.ts config set apiUrl http://localhost:8787`
3. Start chat: `bun run chat`
4. Show:
   - `/remember ...` and `/memories`
   - `/search createBackend`
   - `/read src/backend.ts 1 80`
   - `/file src/cli.ts`
   - ask Acolyte to reason over attached/tool context

## Key Talking Points
- Interactive-first CLI beats dashboard-first UX for coding workflows.
- Persistent memory quality matters more than model swapping.
- Standardizing on Mastra early reduces long-term maintenance cost.
- Soul/behavior docs reduce style drift and improve consistency.

## Open Narrative Threads
- Next: richer transcript-style tool blocks (focused excerpts by default, expandable when needed).
- Add retrieval ranking and memory promotion rules.
- Move persistence from local JSON to centralized Postgres/pgvector.
- Add auth hardening and production deployment path.
