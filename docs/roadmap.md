# Roadmap

Milestone framing for near-term MVP readiness and post-MVP evolution.

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
- [x] ~~Permission flow (read/write modes)~~ replaced by per-tool permissions and mode grants
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

- [x] Saved memory commands work and are useful (`/remember`, `/memory`, `/memory rm`)
- [x] Mastra dependency removed — own the stack with native agentic loop and AI SDK providers
- [x] Context distillation replaces observational memory (MemorySource seam, distill engine, soul prompt integration)
- [x] History-time tool-output pruning for old assistant turns (not only emit-time truncation)
- [x] Rolling history budget policy in agent input assembly (deterministic pruning, no user-visible compaction flow)
- [x] Explicit resume block injection from continuation state (`Current task` / `Next step`)
- [x] Token UX stays low-noise by default: no always-on per-turn footer; `/tokens` remains on-demand and only budget-risk warnings surface inline
- [ ] Evals show measurable reduction in repeated instruction failures
- [ ] Memory doesn't hallucinate or carry stale context

### Milestone 7: Product Polish

Consolidate core UX quality and extension-ready seams before MVP release.

- [x] Single primary UX path (chat-first), with transports as implementation detail
- [x] Typed RPC protocol with request correlation and lifecycle envelopes
- [x] Task-centric execution model with explicit task states and tracing
- [x] Visual regression coverage for TUI/CLI output contracts
- [x] Integration suite split (`*.int.test`) with dedicated `test:int` workflow
- [ ] Full codebase audit and cleanup pass (architecture, reliability, UX consistency, tests)
- [ ] Use `.gitignore` for file discovery instead of hardcoded IGNORED_DIRS
- [ ] Config-driven permissions (user-level grant/deny for tool permission categories)
- [ ] Extension-ready seams in core (interface-first boundaries for lifecycle/tools/guards/tasks/transports), without shipping plugin runtime
- [x] Skill execution parity with tools (stream/output contracts, typed compaction, context budgeting, debug events)
- [x] Queue delivery policy controls (`one-at-a-time` vs `all`) for steering/follow-up (Pi-inspired)
- [x] Resource-loading diagnostics surface in status output (skills/prompt/config collisions and failures)

### Milestone 8: MVP Proof Experiment

Run a reproducible experiment that proves MVP readiness.

- [x] `acolyte-experiment` completes at least one non-trivial vertical slice end-to-end
- [x] Experiment evidence is complete (prompt ledger, verify logs, outcomes)
- [x] Includes at least one failure-and-repair cycle with clear proof
- [ ] Demo flow supports 15-minute launch slot (live slice + evidence backup)

### Milestone 9: Chat Correctness Pass

Finalize chat behavior confidence after experiment proof is complete.

- [ ] End-to-end chat flow passes targeted regression checks
- [ ] Memory continuity has at least one clear cross-session success case
- [ ] Known chat/runtime edge cases are covered by tests or documented constraints

### Milestone 10: Public OSS Release

Open-source local mode with optional self-hosted memory/session sync service.

- [x] README and docs are clear for external contributors
- [x] License chosen and applied
- [x] No hardcoded secrets or internal paths
- [x] CI/CD pipeline for releases
- [x] Pre-OSS security baseline complete (secure defaults, auth coverage, workspace boundary checks, redaction tests)
- [x] Localization baseline: translatable CLI/TUI copy, with raw protocol/tool output kept language-neutral
- [x] Configurable locale (`acolyte config set locale <tag>`) with per-locale catalogs (`src/i18n/locales/*.json`)
- [x] Remove internal launch/talk docs before OSS
- [ ] Migrate `docs/known-issues.md` to GitHub Issues and replace file with link to tracker

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

1. Cloud memory and session sync (no hosted daemon execution): shared memory/session service only, protocol versioning and capability handshake for sync, auth/multi-tenancy, and local-first fallback when cloud sync is unavailable.
2. Friends-and-family adoption: simple setup, day-one value on real projects, 3+ user feedback loops, and major usability fixes.
3. Memory scalability: progressive model-driven compaction for ultra-long sessions, explicit compaction/resume continuity events, and storage backends beyond filesystem.
4. Optional autonomy track: bounded-task soak success, clear failure explainability, and stable protocol baseline under autonomous runs.
5. Long-run task UX: background task IDs, detach/attach flow, clearer task lifecycle visibility, and reserved RPC methods for task control (`task.start`, `task.cancel`, `task.attach`, `task.accepted`, `task.updated`, `task.done`, `task.error`).
6. Session workflows: branching and session-tree navigation for isolated sub-task execution.
7. Safety and policy controls: stronger tool policy, and opt-in guard/evaluator policy controls after observability baselines.
8. Tooling fidelity: structured tool progress payloads, tool-output truncation with on-demand full output, and output-collapsing to reduce noise.
9. Extension surface: runtime hooks (events, tool interceptors, slash commands), agent-authored skills, and resource loader collision diagnostics.
10. Embedding surface: SDK-first local in-process API alongside CLI/RPC.
11. Plan mode: automatic planning phase classified from request intent — read-only tool set, structured plan output, and lifecycle-driven plan→work transition (no user toggle).
