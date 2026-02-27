# Roadmap

## Vision

A centralized AI coding assistant that handles day-to-day development across projects and machines. One assistant, shared sessions and memory, any model. Extensible with custom tools and skills. Built for autonomous execution — plan, edit, verify, iterate — with the developer in control.

## Milestones

### Milestone 1: Build Stability Baseline (completed)

Establish quality gates and smoke coverage to prevent regressions.

- [x] `bun run verify` runs format, lint, typecheck, and tests in one command
- [x] All checks pass on every commit
- [x] Smoke test infrastructure exists and covers basic CLI paths

### Milestone 2: Dogfooding Readiness (completed)

Make the assistant dependable for daily small development slices in this repo.

- [x] Setup and diagnostics work (`/status`, `/tokens`, `/sessions`)
- [x] Permission flow (read/write modes) is stable
- [x] Recovery paths handle errors gracefully
- [x] Assistant can complete simple feature slices with verify green

### Milestone 3: Delegated Switch Trial (completed)

Shift from Codex-led work to assistant-led bounded tasks.

- [x] Assistant completes bounded feature/fix slices end-to-end
- [x] Concurrency guards prevent multi-CLI write conflicts
- [x] Human oversight still required — not autonomous execution

### Milestone 4: Runtime Reliability Signals (completed)

Make in-flight execution and failures visible and actionable.

- [x] Tool lifecycle streaming works (`tool_start` -> `tool_chunk` -> `tool_end`)
- [x] Progress rendering shows real-time tool output
- [x] Empty-output failures return actionable guidance
- [x] Diagnostics commands are useful (`/status`, `/tokens`, `/sessions`)

### Milestone 5: Autonomous Soak (MVP Closure)

End-to-end autonomous execution: plan, edit, verify, iterate.

- [x] Mode-specific instructions (plan/work/verify) with dynamic tool metadata
- [x] Plan detection re-invokes the agent when it plans instead of executing
- [x] Auto-verify after edits (runs project verify command)
- [x] Iterate-on-failure (read errors, fix, re-verify)
- [x] Line width detection enforces project formatting rules
- [x] Run summary debug event for failure tracking
- [x] Configurable model per mode (e.g. cheaper model for plan)
- [x] Single-match guard on edit-file to prevent unintended multi-replacements
- [x] Skills aligned with agentskills.io spec (inline invocation, $ARGUMENTS, multi-dir scan)
- [x] Session-level tool guards (no-rewrite, verify-ran) with composable guard system
- [x] Agent lifecycle architecture — phases, evaluators, RunContext (replaces ad-hoc runAgent)

### Milestone 6: Memory Quality

Reduce repeated mistakes with transparent, correctable memory behavior.

- [ ] Saved memory commands work and are useful (`/remember`, `/memory`, `/memory rm`)
- [ ] Observational memory is tuned — assistant learns from past sessions
- [ ] Evals show measurable reduction in repeated instruction failures
- [ ] Memory doesn't hallucinate or carry stale context

**Current status:** Basic memory commands work. Observational memory is wired up but not tuned. No evals yet.

### Milestone 7: Hosted Readiness

Enable optional hosted mode for centralized memory and multi-device continuity.

- [ ] Backend can run as a hosted service (not just local)
- [ ] Explicit execution mode exists (`local` vs isolated sandbox) and is resolved per request
- [ ] Memory syncs across devices
- [ ] Auth and multi-tenancy work
- [ ] Local-first mode still works without hosted backend

### Milestone 8: Post-MVP Friends and Family

Share with trusted coders for real-world feedback.

- [ ] Setup is simple and documented: clone, install, add API key, run
- [ ] A new user gets value on day one with their own project
- [ ] Feedback collected and acted on from 3+ users
- [ ] Major usability issues resolved

**Blocked on:** Milestones 6-7.

### Milestone 9: Public OSS Release

Open-source core local mode with optional self-host path.

- [ ] README and docs are clear for external contributors
- [ ] License chosen and applied
- [ ] No hardcoded secrets or internal paths
- [ ] CI/CD pipeline for releases

**Blocked on:** Milestone 8.

## MVP Definition

The MVP is reached when a coder friend can **set it up locally, try it on their own project, and find it useful**. Concretely:

- Setup is simple and documented: clone, install, add API key, run.
- The assistant can handle bounded coding tasks reliably enough that a new user gets value on day one.
- It can plan an approach, edit files, run verification, and iterate on failures — at least one cycle without hand-holding.
- Memory works well enough that the assistant improves over a multi-session relationship, not just within one chat.
- The experience is good enough that a friend would use it again voluntarily, not just to be polite.

What MVP is **not**:

- Full autonomy for open-ended tasks with ambiguous requirements.
- Multi-agent or multi-model orchestration.
- Hosted mode or multi-device support.
- Polished distribution (global install, onboarding wizard, etc.).

## Post-MVP Ideas

- Parallel subagents per mode (plan, work, verify) for concurrent execution.
- Mode-based tool filtering at the Mastra level (currently instruction-based, not enforced).
- Session branching — isolated sub-tasks without polluting main context.
- Agent-authored skills — let the agent create and refine its own tools at runtime.
- Tool output collapsing — group consecutive same-tool calls into a single summary row to reduce visual noise.
- User-facing lifecycle hooks — notifications when agent needs input, custom evaluators.
- Memory evaluator — persist learnings between generations within a session.
- Shell fallback guard — block run-command when a dedicated tool exists (e.g. sed → edit-file).

## Known Issues

- Token budgeting uses approximate char-to-token ratios, not actual counts.
- Provider integration is only tested with mocks; real multi-provider coverage is untested.
