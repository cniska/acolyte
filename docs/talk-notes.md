# Talk Notes

## Purpose
Living notes for talks about building this project. Update this file as milestones ship.

## Project Pitch
- Personal AI coding delegate — an assistant that can take over bounded tasks in my projects.
- Built as a vibe-coding project with Codex, learning what works and what doesn't in AI-assisted development.
- CLI-first UX, persistent memory, agentic coding workflows, explicit behavior contract (`docs/soul.md`).

## What Actually Works Today
- Autonomous plan → work → verify loop: the agent plans, edits, runs verification, and iterates on failures.
- Single bounded tasks: create a script, fix a type error, add a test, simple refactors.
- Interactive CLI chat with session management, file references, and tool-backed execution.
- Permission-gated tool use with workspace safety guardrails.
- Persistent memory (user + project scopes) with inspection and correction.
- Verify-first development loop (`bun run verify` after each slice).

## What Doesn't Work Yet
- Reliable complex multi-file changes with design decisions.
- Memory that meaningfully reduces repeated mistakes (infrastructure exists, tuning doesn't).

## Design Principles (Not Moats Yet)
- Reliability-first: verify-first loops, small commits, smoke checks.
- Memory-first: persistent, user-correctable memory that outlives sessions.
- Coding-native: repo-grounded tools and behavior, not generic assistant output.
- Operator-focused: CLI ergonomics with minimal noise and strong control.
- Safe by default: permission modes + path guardrails.

## Architecture Snapshot
- CLI runtime: Bun + TypeScript (`src/cli.ts`)
- Backend API: Bun server (`src/server.ts`)
- Agent lifecycle: `src/agent-lifecycle.ts` (phases + evaluators)
- Agent helpers: `src/agent.ts` (input building, output finalization)
- Tools: repo search/read/git/run/edit + web search/fetch (`src/mastra-tools.ts`)
- Tool guards: `src/tool-guards.ts` (session-level validation)
- Local persistence:
  - sessions: `~/.acolyte/sessions.json`
  - user memory: `~/.acolyte/memory/user/*.md`
  - project memory: `<repo>/.acolyte/memory/project/*.md`
  - config: `~/.acolyte/config.toml` (+ optional `<repo>/.acolyte/config.toml`)

## Why This Stack
- Bun: fast local iteration and simple CLI/backend workflow.
- Mastra: standardized agent/tool primitives. Biggest dependency risk — young framework.
- Ink (React for CLI): strong interactive terminal UI without ncurses complexity.
- Deployable contract: CLI can target local or hosted API.

## Build Process
- Built collaboratively with Codex in commit-sized slices.
- Delivery loop: define slice -> implement -> validate -> commit.
- Standard validation: `bun run verify` (format + lint + typecheck + test).
- ~474 tests, zero lint issues, ~40K lines of TypeScript.

## Key Talking Points
- Vibe-coding can produce production-quality software with the right constraints (verify gates, scoped slices, clear policies).
- The governance layer (soul contract, AGENTS.md) is what keeps AI-generated code coherent.
- Persistent memory is the key differentiator from tools like Claude Code and Aider.
- The hard ceiling is model reliability for chained tool use, not the scaffolding.
- Building an AI tool with AI is the best way to understand AI tool limitations.

## What's Been Shipped
1. Core platform: CLI + backend + Mastra agent/tools + soul contract.
2. Local persistence: sessions + memory (user/project) + layered config.
3. Tool surface: search/read/edit/run/git/status + web search/fetch + AST edit (multi-language).
4. Chat UX: Ink-based interface, shortcuts/pickers, resume/skills, `@path` file references.
5. Memory UX: `/remember`, `/memory`, policy distillation groundwork.
6. Reliability/safety: verify-first loop, permission modes, workspace path guardrails.
7. Dogfooding infrastructure: automated smoke, progress tracking, readiness gates.
8. Live streaming: tool phases, assistant delta streaming, progress rendering.
9. Test infrastructure: shared factory helpers to reduce test boilerplate.
10. Agent lifecycle: composable phases (classify → prepare → generate → evaluate → finalize) with pluggable evaluators.
11. Tool guards: session-level validation (no delete-after-read, verify tracking) with debug visibility.
12. Skills system: extensible slash-command skills aligned with agentskills.io spec.

## Lessons Learned
- Reliability over novelty: verify-first loops, small commits, and smoke checks keep iteration stable.
- Keep execution simple: single-agent runtime, explicit permission controls, minimal user-facing complexity.
- Streaming correctness matters more than formatting polish. When we moved to streaming, the biggest cost was carrying request/response abstractions into a streaming world — recognize when architecture shifts invalidate existing abstractions.
- Memory trust matters: saved context must be inspectable, editable, and scoped clearly.
- Grounded execution beats prompt gymnastics: tool-backed changes are more reliable than heavy post-processing.
- AI-generated docs tend to be over-optimistic. Verify metrics and claims manually.
- Safety defaults matter: read-mode first, guarded roots, explicit escalation.
- UX clarity drives adoption: concise output, strong defaults, low-noise diagnostics.
- Configuration should stay predictable: non-secret file config + env-only secrets with clear precedence.
- Dogfooding readiness should be measurable: gate checks, scoped lookback, explicit remaining-slice signals.
- Keep repo instructions lean: high-signal guidance improves execution quality and cost/latency.
- Keep scope narrow early: premature abstractions (e.g. multi-agent before single-agent is reliable) add complexity without value. Ship the simplest thing that works, then layer on.
- Agent behavior should be lifecycle, not hooks: ad-hoc post-processing in a monolithic function doesn't scale. Decomposing into phases with an evaluator loop makes behaviors composable and testable without modifying the core loop.
- Evaluators > if-chains: plan detection and auto-verify as evaluators means adding new post-generation behavior is one interface + one array entry, not editing a 500-line function.
- Dogfooding reveals architecture gaps: testing Acolyte on real tasks (batch conversion, multi-file refactors) exposed that edit-file needed line-range support and the agent needed structured lifecycle phases — neither was obvious from unit tests alone.

## Demo Flow (Short)
1. `bun run dev` (starts backend + chat).
2. Show: `@src/agent.ts review this file` — tool-backed reasoning over attached context.
3. Show: `edit the function name to camelCase` — automatic verify after edits.
4. Show: `/remember --project always use strict TypeScript` — persistent memory.
5. Show: `/memory` — inspect what the assistant remembers.
6. Show: `/status` — diagnostics and provider info.

## Open Questions
1. Can the autonomous loop be closed with current models, or does it need better foundation models?
2. Is Mastra the right long-term bet, or should the agent layer be thinner?
3. What's the distribution story for non-Bun users?
4. How far can the evaluator pattern scale — can memory, subagents, and self-improvement all be evaluators?
