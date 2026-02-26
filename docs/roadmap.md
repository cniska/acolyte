# Project Plan

## Goal

Build a personal AI coding delegate that can take over bounded tasks in my projects, with the long-term goal of autonomous end-to-end execution (plan -> edit -> verify -> iterate).

## Current State

The assistant is at **step 1 of 3** on the autonomy ladder:

1. **Single bounded tasks** (now): create a script, fix a type error, add a test.
2. **Complex multi-file tasks** (next): implement a feature across multiple files with design decisions.
3. **Iterative autonomous execution** (goal): plan -> edit -> verify -> iterate on failures without human intervention.

The project was built collaboratively with Codex in commit-sized slices.

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

Sustain autonomous end-to-end execution with low fallback across multiple days.

- [ ] Assistant can plan an approach, edit files, verify, and iterate on failures — at least one full cycle
- [ ] Multi-step tasks work (e.g. implement a feature touching 3+ files)
- [ ] Soak window passes: 10+ successful runs over 3+ separate days
- [ ] Smoke checks cover multi-step edit tasks, not just single operations
- [ ] Manual fallback is the exception, not the norm
- [ ] Failure categories are tracked with root-cause fixes

**Current status:** Single bounded tasks work. Multi-step autonomous execution is not working yet. The main blocker is model reliability for chained tool use, not the scaffolding.

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
- [ ] Memory syncs across devices
- [ ] Auth and multi-tenancy work
- [ ] Local-first mode still works without hosted backend

**Blocked on:** Milestone 5.

### Milestone 8: Post-MVP Friends and Family

Share with trusted coders for real-world feedback.

- [ ] Setup is simple and documented: clone, install, add API key, run
- [ ] A new user gets value on day one with their own project
- [ ] Feedback collected and acted on from 3+ users
- [ ] Major usability issues resolved

**Blocked on:** Milestones 5-7.

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

## Known Issues

- Streaming pipeline has fragile multi-level deduplication that can drop legitimate events.
- Token budgeting uses approximate char-to-token ratios, not actual counts.
- Model fallbacks happen silently without user notification.
- Provider integration is only tested with mocks; real multi-provider coverage is untested.
