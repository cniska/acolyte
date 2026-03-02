# Roadmap

## Vision

One AI coding assistant for day-to-day development across projects and machines.
Shared sessions and memory, model-flexible, extensible via tools and skills.
Chat-first and opinionated for the 80% default workflow, with stable seams for customization.
Built for safe autonomous execution of bounded tasks with explicit policy and the developer in control.

## Milestones

### Milestone 1: Foundations (completed)

Establish baseline project quality and repeatable validation.

- [x] `bun run verify` runs format, lint, typecheck, and tests in one command
- [x] All checks pass on every commit
- [x] Smoke test infrastructure exists and covers basic CLI paths

### Milestone 2: Core UX (completed)

Make local setup and core interaction flows dependable.

- [x] Setup and diagnostics work (`/status`, `/tokens`, `/sessions`)
- [x] Permission flow (read/write modes) is stable
- [x] Recovery paths handle errors gracefully
- [x] Assistant can complete simple feature slices with verify green

### Milestone 3: Execution Engine (completed)

Establish the lifecycle and tool execution core.

- [x] Assistant completes bounded feature/fix slices end-to-end
- [x] Lifecycle supports plan/work/verify execution behavior
- [x] Tool execution and streaming events are wired end-to-end

### Milestone 4: Reliability Hardening (completed)

Harden failure handling, safeguards, and runtime visibility.

- [x] Concurrency and anti-loop safeguards prevent common failure patterns
- [x] Progress rendering and diagnostics are actionable (`/status`, `/tokens`, `/sessions`)
- [x] Empty-output and error paths return clear guidance
- [x] Human oversight is still expected for ambiguous/open-ended work

### Milestone 5: Autonomous Reliability (MVP Closure)

The agent can do bounded coding tasks for us end-to-end.

- [x] Understand task and execute in the right mode (plan/work/verify)
- [x] Edit files and run project verification automatically
- [x] Recover from common failures and retry without manual hand-holding
- [x] Return concise, usable outcomes without requiring manual intervention loops
- [x] Lifecycle, guard, and evaluator architecture is explicit and observable
- [x] Guardrails prevent known bad loops and destructive patterns
- [x] Tool progress and error behavior are reliable for daily use
- [x] Per-mode model controls and skill runtime behavior are stable

### Milestone 6: Pre-MVP Product Polish

Consolidate core UX quality and extension-ready seams before MVP freeze.

- [x] Single primary UX path (chat-first), with transports as implementation detail
- [x] Typed RPC protocol with request correlation and lifecycle envelopes
- [x] Task-centric execution model with explicit task states and tracing
- [x] Visual regression coverage for TUI/CLI output contracts
- [x] Integration suite split (`*.int.test`) with dedicated `test:int` workflow
- [ ] Full codebase audit and cleanup pass (architecture, reliability, UX consistency, tests)
- [ ] Extension-ready seams in core (interface-first boundaries for lifecycle/tools/guards/tasks/transports), without shipping plugin runtime
- [ ] Queue delivery policy controls (`one-at-a-time` vs `all`) for steering/follow-up (Pi-inspired)
- [ ] Resource-loading diagnostics surface (skills/prompts/config/reload collisions and failures) (Pi-inspired)

### Milestone 7: Autonomy Proof

Prove consistent autonomous performance across repeated real tasks.

- [ ] Repeated soak runs complete bounded tasks with low manual intervention
- [ ] Success rate threshold is met across dogfood task suites
- [ ] Failure modes are explainable through traces/logs and have clear follow-up actions
- [ ] Protocol baseline is stable (`protocolVersion`, capability handshake, stream compatibility tests)

### Milestone 8: Memory Quality

Reduce repeated mistakes with transparent, correctable memory behavior.

- [ ] Saved memory commands work and are useful (`/remember`, `/memory`, `/memory rm`)
- [ ] Observational memory is tuned — assistant learns from past sessions
- [ ] Evals show measurable reduction in repeated instruction failures
- [ ] Memory doesn't hallucinate or carry stale context

**Current status:** Basic memory commands work. Observational memory is wired up but not tuned. No evals yet.

### Milestone 9: Hosted Readiness

Enable optional hosted mode for centralized memory and multi-device continuity.

- [ ] Backend can run as a hosted service (not just local)
- [ ] Explicit execution mode exists (`local` vs isolated sandbox) and is resolved per request
- [ ] Protocol contract is versioned and transport-agnostic (RPC over HTTP/SSE/WebSocket)
- [ ] Capability handshake exists so clients can adapt safely (`supportsSteer`, `supportsSkills`, etc.)
- [ ] Queue semantics are explicit and stable (`steer` vs `follow-up`)
- [ ] Memory syncs across devices
- [ ] Auth and multi-tenancy work
- [ ] Local-first mode still works without hosted backend

### Milestone 10: Post-MVP Friends and Family

Share with trusted coders for real-world feedback.

- [ ] Setup is simple and documented: clone, install, add API key, run
- [ ] A new user gets value on day one with their own project
- [ ] Feedback collected and acted on from 3+ users
- [ ] Major usability issues resolved

**Blocked on:** Milestones 7-9.

### Milestone 11: Public OSS Release

Open-source core local mode with optional self-host path.

- [ ] README and docs are clear for external contributors
- [ ] License chosen and applied
- [ ] No hardcoded secrets or internal paths
- [ ] CI/CD pipeline for releases
- [ ] Pre-OSS security baseline complete (secure defaults, auth coverage, workspace boundary checks, redaction tests)
- [ ] Localization baseline: translatable CLI/TUI copy, with raw protocol/tool output kept language-neutral

**Blocked on:** Milestone 10.

## MVP Definition

The MVP is reached when a coder friend can **set it up locally, use it on their own project, and want to keep using it**.

- Setup is simple and documented: clone, install, add API key, run.
- The agent can complete bounded coding tasks end-to-end: plan, edit, verify, recover.
- A new user gets value on day one without deep project-specific setup.
- Memory is useful across sessions and does not introduce stale or incorrect behavior.
- The experience is strong enough that users choose to return.

What MVP is **not**:

- Full autonomy for open-ended tasks with ambiguous requirements.
- Multi-agent or multi-model orchestration.
- Hosted mode or multi-device support.
- Polished distribution (global install, onboarding wizard, etc.).

## Post-MVP Ideas

- Local daemon mode for server/client:
  one reusable local server process per machine (auto-discovered/reused), with chat/run clients attaching without manual server process management.
- Parallel subagents per mode (plan, work, verify) for concurrent execution.
- Session branching — isolated sub-tasks without polluting main context.
- Session tree UX for branch navigation, labels, and jump-back workflows.
- Assistant-managed background tasks with stable IDs (`start`, `status`, `cancel`, `attach`).
- Automatic foreground-to-background detachment for long-running work while chat remains responsive.
- Stream protocol compatibility tests (event schema/version contract across client/server).
- Structured tool progress payloads (typed header/body metadata) to replace line-based regex parsing.
- Stronger tool policy enforcement beyond prompt-only guidance.
- Agent-authored skills — let the agent create and refine its own tools at runtime.
- Tool output collapsing — group consecutive same-tool calls into a single summary row to reduce visual noise.
- User-facing lifecycle hooks — notifications when agent needs input, custom evaluators.
- Memory evaluator — persist useful learnings between generations within a session.
- Extension runtime hooks (events + tool interceptors + custom slash commands) with explicit safety boundaries.
- Resource loader diagnostics and collision reporting across user/project/package layers (skills, prompts, themes, extensions).
- Queue policy controls for steering/follow-up delivery (`one-at-a-time` vs `all`) with predictable semantics.
- SDK-first embedding API (local in-process integration) alongside CLI/RPC.

## Known Issues

- Token budgeting uses approximate char-to-token ratios, not actual counts.
- Provider integration is only tested with mocks; real multi-provider coverage is untested.
