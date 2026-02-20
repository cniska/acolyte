# Acolyte Project Plan

## Goal
Build a personal AI assistant using Mastra, with a CLI-first interface and a hosted backend, so memory is centralized and consistent across computers.

## Success Criteria
1. Assistant retains stable user preferences across sessions.
2. Assistant follows project-specific conventions and reduces repeated mistakes.
3. Assistant can execute agentic coding workflows (plan -> implement -> verify -> reflect).
4. Memory can be inspected, edited, and corrected from the CLI.
5. Assistant can be used from multiple computers with shared centralized memory.

## Scope
### In Scope (MVP)
1. Mastra-based assistant service with at least one coding-focused agent.
2. Persistent memory architecture (profile, procedural, episodic).
3. Multi-model support with configurable routing/fallback.
4. Core coding tools: repo search/read, safe file edits, command execution, and test/lint/typecheck verification.
5. CLI for chat, history, and memory inspection/editing.
6. Hosted API/backend on Vercel for centralized access.

### Out of Scope (MVP)
1. Web UI.
2. Mobile apps.
3. Voice interface.
4. Team-level multi-tenant collaboration.
5. Autonomous long-running operations without explicit user approval.

## Proposed Tech Stack
1. Runtime: Bun + TypeScript + Mastra.
2. Interface: Bun CLI (Ink or plain TTY prompts).
3. Backend Hosting: Vercel Functions.
4. Data: Prisma Postgres (via Vercel Marketplace) + pgvector.
5. ORM/Data Layer: Prisma ORM for relational data; raw SQL through Prisma for vector search/index operations.
6. Auth: API key/session token for CLI-to-backend authentication.
4. Cache/queue (optional phase 2): Redis/Upstash.
7. Model providers: OpenAI + Anthropic (+ optional others) through a single routing layer.
8. Code execution sandbox: E2B or Modal.
9. Observability: structured logs + traces + evaluation dataset.

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

### Write Policy
1. Always write user-stated preferences immediately.
2. Promote repeated behavior to procedural memory after N confirmations.
3. Store task outcome summaries on every completed task.
4. Never auto-promote low-confidence inferred preferences.

### Retrieval Policy
1. Retrieve profile + project facts for every request.
2. Retrieve top-K episodes by semantic relevance and recency.
3. Inject hard constraints into system instructions before planning.
4. Show memory snippets used in response for transparency.

## Agentic Workflow
1. Understand request + fetch relevant memory/context.
2. Produce short execution plan.
3. Execute tools iteratively.
4. Run verification gates (tests/lint/typecheck/policy checks).
5. Reflect on failures and retry within limits.
6. Return result + what memory was updated.

## Implementation Phases
## Phase 0: Foundations (Week 1)
1. Create monorepo structure and baseline Mastra + CLI integration.
2. Set up Prisma Postgres, migrations, and base schema.
3. Configure providers and model routing.
4. Implement local CLI bootstrap (`acolyte` command).
5. Scaffold Vercel API endpoints for CLI connectivity.

## Phase 1: MVP CLI Assistant (Weeks 2-3)
1. Implement interactive CLI commands first with backend auth.
2. Implement coding assistant agent and tool orchestration.
3. Add toolset for repo read/search/edit, git context, and command execution.
4. Implement memory read/write APIs and retrieval hooks in hosted backend.
5. Add history and memory inspection/edit commands.
6. Add minimal batch mode (`run` and `run --file`) for scripting.

## Phase 2: Reliable Memory (Weeks 4-5)
1. Add memory ranking and promotion rules.
2. Add feedback capture and correction workflow in CLI.
3. Add memory-related eval tests.
4. Add import/export for memory backups.

## Phase 3: Quality and Safety (Weeks 6-7)
1. Add verification gates and retry policies.
2. Add sandboxed code execution.
3. Add audit logs and trace dashboards.
4. Add failure mode playbooks.

## Phase 4: Deployment and Operations (Week 8)
1. Deploy backend to Vercel and connect Prisma Postgres.
2. Add local install/run scripts and environment docs for multi-machine CLI use.
3. Add backup/restore workflow for centralized memory DB.
4. Add release process (versioning + changelog).

## Deliverables
1. Working CLI assistant (`acolyte`) usable from multiple computers.
2. Mastra agent/workflow codebase.
3. Hosted backend on Vercel with persistent memory database and migrations.
4. Documented memory policy and governance.
5. Evaluation suite for quality regression checks.

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

## Next Actions
1. Prioritize interactive CLI UX polish; keep batch mode intentionally minimal.
2. Create technical design doc (`docs/technical-design.md`).
3. Add explicit tool traces/evidence in responses for transparency and debugging.
4. Create implementation backlog from phases.
