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

### Milestone 1: Build Stability Baseline
Status: completed (February 21, 2026).
Goal: establish quality gates (`bun run verify`) and smoke coverage to prevent regressions.

### Milestone 2: Dogfooding Readiness
Status: completed (February 24, 2026).
Goal: make the assistant dependable for daily small development slices in this repo.
Summary: setup/diagnostics, permission flow, recovery paths, and basic smoke checks are stable. The assistant can complete simple feature slices with verify green.

### Milestone 3: Delegated Switch Trial
Status: completed (February 24, 2026).
Goal: shift from Codex-led work to assistant-led bounded tasks.
Summary: the assistant has completed multiple delegated feature/fix slices end-to-end. Concurrency guards prevent multi-CLI writes. However, "delegated" here means single bounded tasks with human oversight — not autonomous execution.

### Milestone 4: Runtime Reliability Signals
Status: completed (February 24, 2026).
Goal: make in-flight execution and failures visible and actionable.
Summary: tool lifecycle streaming (`tool_start -> tool_chunk -> tool_end`), progress rendering, permission flow, and diagnostics (`/status`, `/tokens`, `/sessions`) are working. Empty-output failures return actionable guidance.

### Milestone 5: Autonomous Soak (MVP Closure)
Status: in progress — **not close to done**.
Goal: sustain autonomous end-to-end execution with low fallback across multiple days.

Where it actually stands:
- Single bounded tasks work reliably.
- Multi-step autonomous execution (plan -> edit -> verify -> iterate on failures) is not working yet.
- The soak window criteria (10+ runs over 3+ days) have not been met.
- Smoke infrastructure exists but has not been exercised against real autonomous multi-step tasks.
- The main blocker is model reliability for chained tool use, not the scaffolding.

Exit criteria (unchanged):
- Strict autonomy gate passes across a soak window (at least 10 runs over at least 3 separate days).
- Autonomous coding checks include multi-line/multi-step edit tasks.
- Manual fallback remains the exception path.
- Failure categories are tracked with root-cause fixes or tracked items.

### Milestone 6: Memory Quality
Status: in progress — early.
Goal: reduce repeated mistakes with transparent, correctable memory behavior.

Where it actually stands:
- Basic memory commands work (`/remember`, `/memory`, `/memory rm`).
- Observational memory (via Mastra) is wired up but not tuned.
- No evals yet for measuring reduction in repeated instruction failures.

### Milestone 7: Hosted Readiness
Status: planned. Blocked on closing the autonomous loop first.
Goal: enable optional hosted mode for centralized memory and multi-device continuity.

### Milestone 8: Post-MVP Friends and Family
Status: planned. Blocked on Milestones 5-7.
Goal: share with trusted coders for real-world feedback.

### Milestone 9: Public OSS Release
Status: planned. Blocked on friends-and-family feedback.
Goal: open-source core local mode with optional self-host path.

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

## MVP Gate
Status: **not met**.
The autonomous coding loop is not closed. The assistant can handle single bounded tasks but cannot reliably chain plan -> edit -> verify -> iterate without human intervention. Milestone 5 is the key blocker.

## Known Issues
- Progress/status contracts were simplified to a single-agent, single-model shape.
- Docs written by Codex tend to be over-optimistic — evidence blocks and metrics should be verified manually.
- Provider integration is only tested with mocks; real multi-provider coverage is untested.
