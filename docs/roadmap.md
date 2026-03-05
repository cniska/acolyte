# Roadmap

Direction and milestone framing for near-term and long-term product evolution.

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

### Milestone 5: Autonomous Reliability (completed)

The agent can do bounded coding tasks for us end-to-end.

- [x] Understand task and execute in the right mode (plan/work/verify)
- [x] Edit files and run project verification automatically
- [x] Recover from common failures and retry without manual hand-holding
- [x] Return concise, usable outcomes without requiring manual intervention loops
- [x] Lifecycle, guard, and evaluator architecture is explicit and observable
- [x] Guardrails prevent known bad loops and destructive patterns
- [x] Tool progress and error behavior are reliable for daily use
- [x] Per-mode model controls and skill runtime behavior are stable

### Milestone 6: Memory Reliability

Reduce repeated mistakes with transparent, correctable memory behavior.

- [ ] Saved memory commands work and are useful (`/remember`, `/memory`, `/memory rm`)
- [x] Mastra dependency removed — own the stack with native agentic loop and AI SDK providers
- [x] Context distillation replaces observational memory (MemorySource seam, distill engine, soul prompt integration)
- [x] History-time tool-output pruning for old assistant turns (not only emit-time truncation)
- [x] Rolling history budget policy in agent input assembly (deterministic pruning, no user-visible compaction flow)
- [x] Explicit resume block injection from continuation state (`Current task` / `Next step`)
- [ ] Footer token output is visible per turn (prompt/completion/total/budget)
- [ ] Evals show measurable reduction in repeated instruction failures
- [ ] Memory doesn't hallucinate or carry stale context

**Current status:** Mastra removed. Context distillation implemented (MemorySource contract, observer/reflector pipeline, lifecycle integration). Needs eval validation.

### Milestone 7: Memory Scalability

Extend memory behavior for long autonomous runs and broader deployment targets.

- [ ] Progressive model-driven compaction for ultra-long sessions
- [ ] Compaction/resume protocol events for explicit agent continuity
- [ ] Storage backends beyond filesystem (shared memory/session sync persistence, no remote daemon execution)

### Milestone 8: Product Polish

Consolidate core UX quality and extension-ready seams before MVP release.

- [x] Single primary UX path (chat-first), with transports as implementation detail
- [x] Typed RPC protocol with request correlation and lifecycle envelopes
- [x] Task-centric execution model with explicit task states and tracing
- [x] Visual regression coverage for TUI/CLI output contracts
- [x] Integration suite split (`*.int.test`) with dedicated `test:int` workflow
- [ ] Full codebase audit and cleanup pass (architecture, reliability, UX consistency, tests)
- [ ] Extension-ready seams in core (interface-first boundaries for lifecycle/tools/guards/tasks/transports), without shipping plugin runtime
- [ ] Skill execution parity with tools (stream/output contracts, typed compaction, context budgeting, debug events)
- [ ] Queue delivery policy controls (`one-at-a-time` vs `all`) for steering/follow-up (Pi-inspired)
- [ ] Resource-loading diagnostics surface (skills/prompts/config/reload collisions and failures) (Pi-inspired)

### Milestone 9: Public OSS Release (MVP)

Open-source core local mode with optional self-hosted memory/session sync service.

- [ ] README and docs are clear for external contributors
- [ ] License chosen and applied
- [ ] No hardcoded secrets or internal paths
- [ ] CI/CD pipeline for releases
- [ ] Pre-OSS security baseline complete (secure defaults, auth coverage, workspace boundary checks, redaction tests)
- [ ] Localization baseline: translatable CLI/TUI copy, with raw protocol/tool output kept language-neutral

**Blocked on:** Milestones 6-8.

## MVP Definition

The MVP is reached when a coder friend can **set it up locally, use it on their own project, and want to keep using it**.

- Setup is simple and documented: clone, install, add API key, run.
- The agent can complete bounded coding tasks end-to-end: plan, edit, verify, recover.
- A new user gets value on day one without deep project-specific setup.
- Memory is useful across sessions and does not introduce stale or incorrect behavior.
- The experience is strong enough that users choose to return.

What MVP is **not**:

- Full autonomy for open-ended tasks with ambiguous requirements.
- Multi-agent orchestration.
- Hosted mode or multi-device support.
- Polished distribution (global install, onboarding wizard, etc.).

## Post-MVP Priorities (Ordered)

1. Cloud memory and session sync (no hosted daemon execution):
shared memory/session service only, protocol versioning and capability handshake for sync, auth/multi-tenancy, and local-first fallback when cloud sync is unavailable.
2. Friends-and-family adoption:
simple setup, day-one value on real projects, 3+ user feedback loops, and major usability fixes.
3. Optional autonomy track:
bounded-task soak success, clear failure explainability, and stable protocol baseline under autonomous runs.
4. Long-run task UX:
background task IDs, detach/attach flow, and clearer task lifecycle visibility.
5. Session workflows:
branching and session-tree navigation for isolated sub-task execution.
6. Safety and policy controls:
stronger tool policy, and opt-in guard/evaluator policy controls after observability baselines.
7. Tooling fidelity:
structured tool progress payloads, tool-output truncation with on-demand full output, and output-collapsing to reduce noise.
8. Extension surface:
runtime hooks (events, tool interceptors, slash commands), agent-authored skills, and resource loader collision diagnostics.
9. Embedding surface:
SDK-first local in-process API alongside CLI/RPC.

## Known Issues

- Token budgeting uses approximate char-to-token ratios, not actual counts.
- Provider integration is only tested with mocks; real multi-provider coverage is untested.
