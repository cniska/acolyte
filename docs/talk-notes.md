# Acolyte Talk Notes

## Purpose
Living notes for talks about building Acolyte. Update this file as milestones ship so demos and explanations stay accurate.

## Project Pitch
- Acolyte is a personal AI coding assistant with:
  - interactive CLI-first UX
  - centralized memory across devices
  - agentic workflows and coding tools
  - explicit behavior contract in `docs/soul.md`

## Moat Narrative
- Reliability moat: fewer repeated mistakes via a verify-first execution loop.
- Memory moat: persistent, user-correctable memory that outlives single sessions.
- Workflow moat: coding-native tools and repo-grounded behavior, not generic assistant output.
- UX moat: operator-focused CLI ergonomics with minimal noise and strong control.

## Current Architecture (as of 2026-02-20)
- CLI runtime: Bun + TypeScript (`src/cli.ts`)
- Backend API: Bun server with `/v1/chat` and `/healthz` (`src/server.ts`)
- Agent runtime: Mastra `Agent` (`src/agent.ts`)
- Tools: Mastra tools for repo search/read/git/run/edit (`src/mastra-tools.ts`)
- Local persistence:
  - sessions: `~/.acolyte/sessions.json`
  - user memory notes: `~/.acolyte/memory/user/*.md`
  - project memory notes: `<repo>/.acolyte/memory/project/*.md`
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
  - moved chat UI to Ink with stable prompt/transcript separation
  - added session controls (`/new`, `/sessions`, `/resume`) and skills picker UX
  - added in-chat memory commands (`/remember [--project]`, `/memories`)
  - added in-chat `/dogfood <task>` for verify-first autonomous coding tasks with automatic local `bun run verify`
  - added in-chat `/dogfood-status` (`/ds`) for quick dogfooding readiness checks
  - added in-chat `/changes` for quick git status + diff summary without leaving chat
  - switched memory store to Markdown files with frontmatter (user + project scopes)
  - added `@path` suggestions in chat and attachment of referenced files to model context
  - expanded `@path` attachment to include directories (compact tree context)
  - improved prompt ergonomics (word navigation, reliable delete behavior, autocomplete fixes)
  - added slash-command suggestions with keyboard selection/autocomplete (arrows + Tab/Enter)
  - added compact slash aliases for common flows (`/df`, `/ds`, `/mem`, `/rem`)
  - centralized provider/model routing config (role model fallback + provider-aware model presentation)
  - tightened review style policy (concise, evidence-first, no destructive git suggestions)
  - polished transcript output (compact tool blocks, no-result clarity, duration summaries)
  - hardened empty-output handling with explicit assistant/review fallbacks instead of blank replies
  - added lightweight semantic highlighting in assistant responses (code/commands/file refs)
  - added canonical feature inventory in `docs/features.md` and linked it from README
- Delivery workflow:
  - `bun run verify` (`typecheck` + tests)
  - autonomous feature loop in `docs/development-workflow.md`
  - local skill scaffold in `skills/autonomous-feature-delivery/SKILL.md`

## Demo Flow (Short)
1. Start backend: `bun --env-file=.env run serve`
2. Set CLI backend once: `bun run src/cli.ts config set apiUrl http://localhost:6767`
3. Start chat: `bun run chat`
4. Show:
   - `@src/agent.ts review this file`
   - `/remember [--project] ...` and `/memories`
   - `/resume` and `/skills`
   - tool-backed reasoning over attached file context

## Key Talking Points
- Interactive-first CLI beats dashboard-first UX for coding workflows.
- Persistent memory quality matters more than model swapping.
- Standardizing on Mastra early reduces long-term maintenance cost.
- Soul/behavior docs reduce style drift and improve consistency.

## Lessons Learned
- Reliability beats novelty: verify-first loops and small commits prevent drift.
- Memory must be transparent and editable, otherwise trust decays quickly.
- UX details matter: prompt ergonomics and low-noise output have outsized impact.
- `@file` references are only valuable when they attach real context, not just visual autocomplete.
- Subagents work better when each role gets explicit context (goal, scope, expected output), not implicit routing guesses.

## Open Narrative Threads
- Next: richer transcript-style tool blocks (focused excerpts by default, expandable when needed).
- Add retrieval ranking and memory promotion rules.
- Move persistence from local JSON to centralized Postgres/pgvector.
- Add auth hardening and production deployment path.
