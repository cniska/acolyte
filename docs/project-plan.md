# Acolyte Project Plan

## Goal
Build a personal AI assistant using Mastra, with a CLI-first interface that runs locally by default and supports optional hosted deployment for centralized memory across computers.

## Product Principles
1. BYO-first: users should be able to run Acolyte with their own API keys and infrastructure.
2. Local-first: default setup should work fully on a single machine with minimal dependencies.
3. Hosted-optional: cloud deployment is an opt-in for cross-device memory and collaboration.
4. No mandatory Acolyte SaaS: core functionality must not depend on a vendor-hosted control plane.

## Success Criteria
1. Assistant retains stable user preferences across sessions.
2. Assistant follows project-specific conventions and reduces repeated mistakes.
3. Assistant can execute agentic coding workflows (plan -> implement -> verify -> reflect).
4. Memory can be inspected, edited, and corrected from the CLI.
5. Assistant can be used from multiple computers with shared centralized memory.

## Missing For Goal (Current Gaps)
1. Automatic preference learning loop is only partially implemented; we still need confidence-scored promotion and correction flow for observational memory.
2. Memory transparency is incomplete; we need clear per-reply “memory used” visibility and lightweight memory debugging views.
3. Cross-device centralized memory is not implemented yet (hosted mode still planned, local-first only by default).
4. Tooling for robust coding execution is baseline only; we still need safer edit/apply flows and stronger verification orchestration for autonomous feature delivery.
5. Reliability guardrails are still maturing; we need eval gates that specifically measure repeated-mistake reduction across sessions.
6. Full dogfooding transition is not complete; Acolyte-led development loops need to become the default path for feature work in this repo.
7. Model selection is still mostly static; we need task-aware routing (chat/code/long-context/vision) with measurable quality/cost tradeoffs.
8. Local model support is not fully productized; we need first-class configuration for OpenAI-compatible local endpoints (Ollama/vLLM) and routing integration.
9. Token efficiency needs explicit controls; we need hard context budgets, tool-output compression defaults, and lane-based model routing to prevent cost/latency blowups.

## Product Moat
1. Reliability moat: verification-first coding loop (plan, tool-grounded execution, validate, reflect) that measurably reduces repeated mistakes.
2. Memory moat: persistent, editable, transparent memory that captures explicit preferences plus confidence-scored observations.
3. Workflow moat: strong fit for real coding workflows (repo tools, tests, diff-aware edits, session continuity) instead of generic chat.
4. UX moat: fast, minimal, high-signal CLI interface that keeps operator trust and control.
5. Data moat: longitudinal personal workflow context (decisions, corrections, outcomes) centralized across devices.

## Scope
### In Scope (MVP)
1. Mastra-based assistant service with at least one coding-focused agent.
2. Persistent memory architecture (profile, procedural, episodic).
3. Multi-model support with configurable routing/fallback.
4. Core coding tools: repo search/read, safe file edits, command execution, and test/lint/typecheck verification.
5. CLI for chat, history, and memory inspection/editing.
6. Optional hosted API/backend on Vercel for centralized access.
7. Local backend + local memory mode as first-class setup path.

### Out of Scope (MVP)
1. Web UI.
2. Mobile apps.
3. Voice interface.
4. Third-party messaging channel integrations (for example WhatsApp/OpenClaw).
5. Team-level multi-tenant collaboration.
6. Autonomous long-running operations without explicit user approval.

## Proposed Tech Stack
1. Runtime: Bun + TypeScript + Mastra.
2. Interface: Bun CLI (Ink or plain TTY prompts).
3. Backend Hosting (optional): Vercel Functions.
4. Data: local SQLite (default) or Prisma Postgres (optional hosted mode) + pgvector.
5. ORM/Data Layer: Prisma ORM for relational data; raw SQL through Prisma for vector search/index operations when using pgvector.
6. Auth: API key/session token for CLI-to-backend authentication.
7. Cache/queue (optional phase 2): Redis/Upstash.
8. Model providers: OpenAI + Anthropic + Gemini + local OpenAI-compatible endpoints (Ollama/vLLM) through a single routing layer.
9. Code execution sandbox: E2B or Modal.
10. Observability: structured logs + traces + evaluation dataset.
11. Channel adapters (post-MVP): OpenClaw/Twilio bridge for WhatsApp and other messaging channels.

## Architecture
1. CLI Layer:
   - Interactive chat mode (primary surface).
   - Non-interactive one-shot mode (minimal scripting support).
   - Commands for memory/history inspection and editing.
2. API/Backend Layer (Vercel):
   - Authenticated endpoints for chat, tool orchestration, and memory operations.
   - Session management and request validation.
3. Agent Layer (Mastra):
   - Planner agent for decomposition.
   - Executor agent for coding/tool use.
   - Reviewer agent for checks and reflection.
4. Tool Layer:
   - Repository tools (read/search/write diffs).
   - Command tools (run/typecheck/test via command execution).
   - Git tools (status/diff/log/branch-aware context).
   - Memory tools (write/read/promote/forget).
5. Memory Layer:
   - Profile memory: stable user preferences and coding style.
   - Procedural memory: reusable playbooks/checklists.
   - Episodic memory: session summaries, decisions, and mistakes.
6. Retrieval + Ranking:
   - Semantic similarity + recency + confidence scoring.
   - Hard preference injection before generation.
7. Persistence:
   - Conversation events, memory records, tool traces in Prisma Postgres.

## Memory Design
### Memory Types
1. `profile_preferences`: explicit long-lived preferences.
2. `workflow_playbooks`: step-by-step procedures.
3. `project_facts`: repo conventions and constraints.
4. `episodes`: summarized past tasks and outcomes.
5. `feedback_events`: thumbs up/down + corrections.
6. `observations`: inferred behavioral patterns from repeated interactions (confidence-scored, never hard constraints by default).

### Write Policy
1. Always write user-stated preferences immediately.
2. Promote repeated behavior to procedural memory after N confirmations.
3. Store task outcome summaries on every completed task.
4. Never auto-promote low-confidence inferred preferences.
5. Record observational memory only after repeated signals and attach confidence + source episodes.
6. Require explicit promotion before observational memory is treated as a hard preference.

### Retrieval Policy
1. Retrieve profile + project facts for every request.
2. Retrieve top-K episodes by semantic relevance and recency.
3. Inject hard constraints into system instructions before planning.
4. Show memory snippets used in response for transparency.
5. Use observational memory as soft ranking hints unless explicitly confirmed by the user.

## Agentic Workflow
1. Understand request + fetch relevant memory/context.
2. Produce short execution plan.
3. Execute tools iteratively.
4. Run verification gates (tests/lint/typecheck/policy checks).
5. Reflect on failures and retry within limits.
6. Return result + what memory was updated.

## Implementation Phases
Phases are milestone-based, not calendar-bound.

## Phase 0: Foundations
1. Create monorepo structure and baseline Mastra + CLI integration.
2. Set up local-first persistence, migrations, and base schema.
3. Configure providers and model routing.
4. Implement local CLI bootstrap (`acolyte` command).
5. Scaffold optional Vercel API endpoints for remote CLI connectivity.

## Phase 1: MVP CLI Assistant
1. Implement interactive CLI commands first with backend auth.
2. Implement coding assistant agent and tool orchestration.
3. Add toolset for repo read/search/edit, git context, and command execution.
4. Implement memory read/write APIs and retrieval hooks in hosted backend.
5. Add history and memory inspection/edit commands.
6. Add minimal batch mode (`run` and `run --file`) for scripting.

## Phase 2: Reliable Memory
1. Add memory ranking and promotion rules.
2. Add feedback capture and correction workflow in CLI.
3. Add memory-related eval tests.
4. Add import/export for memory backups.
5. Add observational-memory pipeline (signal extraction, confidence scoring, promotion guardrails).

## Phase 3: Quality and Safety
1. Add verification gates and retry policies.
2. Add sandboxed code execution.
3. Add audit logs and trace dashboards.
4. Add failure mode playbooks.

## Phase 4: Deployment and Operations
1. Deploy backend to Vercel and connect Prisma Postgres (optional hosted path).
2. Add local install/run scripts and environment docs for multi-machine CLI use.
3. Add backup/restore workflow for centralized memory DB.
4. Add release process (versioning + changelog).

## Deliverables
1. Working CLI assistant (`acolyte`) usable from multiple computers.
2. Mastra agent/workflow codebase.
3. Local-first setup docs and scripts (single-machine, BYO keys).
4. Optional hosted backend on Vercel with persistent memory database and migrations.
5. Documented memory policy and governance.
6. Evaluation suite for quality regression checks.
7. Subagent routing baseline (planner/coder/reviewer) with explicit per-role context handoff.

## Risks and Mitigations
1. Memory drift or wrong assumptions.
   - Mitigation: explicit confidence scores + manual review + correction commands.
2. Hallucinated repo facts.
   - Mitigation: require tool-grounded evidence for project claims.
3. Cost spikes from model usage.
   - Mitigation: routing policy, token budgets, fallback models.
4. Long-running task failures.
   - Mitigation: bounded tasks, retries, and resumable workflows.
5. Vercel execution limits for heavy jobs.
   - Mitigation: offload heavy/long jobs to async workers when needed.

## Open Decisions
1. Preferred primary model and fallback model order.
2. Interactive-first command surface details (`chat` + slash commands as primary UX).
3. Sandbox provider choice (E2B vs Modal).
4. Packaging target (`npm` global vs standalone binary).
5. Async job strategy (Vercel-native vs external worker).
6. How far to evolve from v1 subagent routing (single-role-per-turn) to true multi-step delegation.
7. Channel adapter rollout timing (WhatsApp via OpenClaw/Twilio) and auth model for cross-device messaging.
8. Initial task-lane routing policy (`chat`, `code`, `long-context`, `vision`) and per-lane fallback order.
9. Local model strategy for default installs (optional by default vs recommended baseline for coding lane).

## Next Actions
1. Prioritize interactive CLI UX polish; keep batch mode intentionally minimal.
2. Create technical design doc (`docs/technical-design.md`).
3. Iterate on richer transcript-style tool blocks (Edit/Bash summaries with focused excerpts).
4. Create implementation backlog from phases.
5. Adopt `docs/development-workflow.md` as the default feature-delivery loop.
6. Expand `/resume` UX (session picker/listing ergonomics) on top of current ID-prefix resume flow.
7. Add a dogfooding transition milestone: move from Codex-led development to Acolyte-led development in this repo after coding-loop reliability gates are met.
8. Evaluate and tune the current resource-scoped observational memory setup (cost, precision, promotion quality) before broader automatic preference promotion.
9. Keep subagent v1 simple and deterministic (heuristic router + explicit context), then evaluate optional richer delegation only after stability gates.
10. Continue CLI UX convergence with Codex/Claude patterns while preserving minimalism (slash suggestions + picker flows via shared components).
11. Keep provider/model routing centralized in one config module to avoid drift across CLI/backend/agent wiring.
12. Add a package script to launch Mastra Studio once Mastra app wiring is production-ready for inspection/debugging.
13. Tune `@path` autocomplete filtering for discoverability: keep gitignored paths visible by default and add optional `.acolyteignore` support for user-controlled exclusions.
14. Evaluate opt-in git hooks for high-signal checks only (for example `pre-push` verify), avoid mandatory noisy hooks.
15. Execute a staged dogfooding ramp on `main`: start with low-risk tasks, then graduate to isolated feature slices as reliability remains stable.
16. Maintain `docs/features.md` as the canonical shipped/in-progress/planned feature inventory, and keep README pointing to it.
17. Evaluate post-MVP channel adapter path for messaging access (WhatsApp/OpenClaw), including auth, rate limits, and privacy controls.
18. Implement task-lane model routing with explicit config (`chat`, `code`, `long-context`, `vision`) and fallback chain instrumentation.
19. Add first-class local model support via OpenAI-compatible base URLs (Ollama/vLLM), including docs, smoke checks, and lane-specific overrides.
20. Add token-usage guardrails: hard prompt/context budgets, default compact tool output, and token telemetry per reply.
21. Prioritize a TypeScript-first development lane (Bun/Node/TS defaults, typecheck+test workflow) before expanding language-specific support for other stacks.

## Prioritization Policy
1. Prioritize correctness, reliability, and core workflow capability over cosmetic UX changes.
2. When UX polish is postponed for higher-priority work, record the specific deferred item under `Deferred Improvements`.

## Deferred Improvements
1. Full Claude-style transcript rendering in CLI output (structured `Edit(...)` / `Bash(...)` blocks with compact per-tool summaries).

## Known Issues
1. Some terminal profiles may still emit unmapped `Cmd` key sequences; capture-and-map follow-ups should be added as encountered.
