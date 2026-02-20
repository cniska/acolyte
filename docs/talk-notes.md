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

## Milestones Log
### 2026-02-20
- Scaffolded CLI with session persistence and slash commands.
- Added backend contract (`/v1/chat`) and status checks.
- Added persistent memory notes and memory injection.
- Added file context attachment support.
- Added coding tools (`search`, `read`, `git-status`, `git-diff`, `run`, `edit`) in CLI.
- Migrated backend to Mastra Agent + Mastra tools.
- Added soul document (`docs/soul.md`) and wired it into backend instructions.
- Added `/resume` session command and cleaned up CLI UX/header.
- Added stronger tool-use behavior (multi-step execution + required-tool retry for tool-like requests).
- Added response-level tool transparency (`Tools used` + concise evidence paths when available).
- Added compact, tool-specific output formatting for `search/read/diff/run/status`.
- Polished list-style UX for sessions/history/memory with concise headers and readable timestamps.
- Updated `edit` output to a compact `Update(path)` block with replacement summary + added/removed lines + excerpt.
- Added `bun run verify` and documented a stepwise autonomous feature workflow (`docs/development-workflow.md`).
- Added local skill scaffold for autonomous feature delivery (`skills/autonomous-feature-delivery/SKILL.md`).

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
- Next: richer transcript-style tool blocks (Edit/Bash summaries with focused line excerpts).
- Add retrieval ranking and memory promotion rules.
- Move persistence from local JSON to centralized Postgres/pgvector.
- Add auth hardening and production deployment path.
