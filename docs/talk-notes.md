# Talk Notes

## Purpose
Living notes for talks about building this project. Update this file as milestones ship so demos and explanations stay accurate.

## Project Pitch
- Personal AI coding assistant focused on coding execution:
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
7. Reliability/safety: verify-first loop, permission modes, workspace path guardrails.
8. Routing/config: single configured model + provider across the runtime (no multi-role model routing).
9. Feature documentation: `docs/features.md` as inventory.
10. Dogfooding readiness: automated `bun run dogfood:smoke` + isolated one-shot OM resource IDs for `run`/`dogfood`.
11. Script maintainability: complex `package.json` shell flows moved into reusable `scripts/*.sh` wrappers.
12. Live UX reliability: consistent streamed tool phases (`tool_start -> tool_chunk -> tool_end`), assistant delta streaming, and codex-style diff output with aligned numbered lines.

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
- Reliability over novelty: verify-first loops, small commits, and smoke checks keep iteration stable.
- Keep execution simple: single-agent runtime, explicit permission controls, and minimal user-facing complexity.
- Streaming correctness matters more than formatting polish: users need trustworthy live events before visual refinements.
- Memory trust matters: saved context must be inspectable, editable, and scoped clearly.
- UX clarity drives adoption: concise output, strong defaults, and low-noise command diagnostics.
- Grounded execution beats prompt gymnastics: tool-backed changes and concrete validation are more reliable than heavy post-processing.
- Configuration should stay predictable: non-secret file config + env-only secrets with clear precedence.
- Safety defaults matter: read-mode first, guarded file/shell roots, and explicit escalation points.
- Operational scripts should be robust and debuggable: argv execution, strict argument parsing, and actionable failure messages.
- Dogfooding readiness should be measurable: gate checks, scoped lookback, and explicit remaining-slice signals.
- Keep repo instructions lean: high-signal guidance improves execution quality and cost/latency.

## Open Narrative Threads
1. Continue dogfooding ramp from Codex-led to assistant-led development.
2. Improve memory promotion/retrieval quality and transparency.
3. Complete hosted readiness (Postgres/pgvector + backup/restore + auth hardening).
4. Keep single-agent runtime as default; evaluate optional multi-model routing only for concrete workflows.
5. Refine transcript/tool output for maximal signal with minimal noise.
