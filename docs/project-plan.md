# Acolyte Project Plan

## Goal
Build a personal AI coding assistant (Mastra + CLI) that is local-first, memory-aware, and optionally deployable for shared cross-device memory.

## Principles
1. BYO-first (keys + infra).
2. Local-first default; hosted is optional.
3. CLI-first UX (fast, minimal, high-signal).
4. Safe-by-default automation (permissions + path guardrails).
5. Apply extra scrutiny to chat UX changes: prefer minimal surface-area updates with tests + smoke checks before merge.

## Success Criteria
1. Preference and workflow memory persists across sessions.
2. Assistant reduces repeated mistakes on real coding tasks.
3. Plan -> execute -> verify loop is reliable by default.
4. Memory is inspectable/correctable from CLI.
5. Optional hosted mode enables shared memory across machines.

## Current Gaps
1. Preference learning loop is incomplete (confidence + promotion + correction).
2. Memory transparency needs better per-reply visibility/debugging.
3. Hosted shared-memory mode is not production-ready.
4. Coding loop needs stronger safety/verification orchestration.
5. Dogfooding transition (Codex -> Acolyte-led dev) is not complete.
6. Task-lane model routing and local-model support are incomplete.
7. Token budget controls need iterative tuning for real-world cost/latency.

## Scope (MVP)
### In Scope
1. Mastra-based coding agent with planner/coder/reviewer roles.
2. CLI chat as primary UX (+ minimal batch support).
3. Core coding tools: read/search/edit/run/test/git context.
4. Persistent memory (explicit + observational foundations).
5. Local mode first, optional hosted backend on Vercel + Postgres/pgvector.

### Out of Scope
1. Web/mobile/voice UI.
2. Team multi-tenant collaboration.
3. Messaging channels (WhatsApp/OpenClaw) in MVP.
4. Fully autonomous long-running ops without user approval.

## Tech Stack
1. Bun + TypeScript + Mastra.
2. Ink-based CLI.
3. Prisma + Postgres/pgvector (hosted path), local-first memory mode.
4. Multi-provider model routing (OpenAI/Anthropic/Gemini + OpenAI-compatible local endpoints later).

## Core Architecture
1. CLI: chat loop, slash commands, pickers, history/memory commands.
2. Backend: chat/tool/memory endpoints + session/auth + health/admin.
3. Agent layer: role-based subagents with scoped tools.
4. Memory layer: profile/project/episodes/observations with guarded promotion.

## Delivery Plan
### Phase A (Now): CLI Reliability + Dogfooding
1. Stabilize interactive UX (shortcuts, pickers, autocomplete, history).
2. Enforce safe execution defaults (permission modes + path restrictions).
3. Tighten output quality (user-focused summaries, concise review format).
4. Use Acolyte for increasing share of repo work; track failures and fixes.

## Milestones (Near-Term)
1. Milestone 1: Build Stability Baseline
   - Status: completed on February 21, 2026.
   - Evidence:
   - `bun run verify` is green after each implementation slice.
   - Smoke checks pass for `status`, `run "hello"`, and OM admin safety (`om:wipe` refuses without `--yes`).
   - Core chat command coverage includes `/status`, `/permissions`, and `/dogfood` in automated tests.
   - Exit criteria:
   - `bun run verify` green after each slice.
   - Automated smoke green for `status`, `run "hello"`, OM admin safety (`wipe` requires `--yes`).
   - No regressions in core chat commands (`/status`, `/permissions`, `/dogfood`).
2. Milestone 2: Dogfooding Readiness
   - Status: in progress (near gate-ready).
   - Current evidence:
   - Output shaping is now constrained for dogfood (`Immediate action:` normalization).
   - Dogfood output strips quick-status / pick-one / A-B-C scaffolding, preserving one actionable line.
   - Session-recovery command paths (`/new`, `/resume`, `/permissions`) are covered by automated tests.
   - One-shot `run` is isolated from persisted chat history (plus regression test).
   - One-shot `run`/`dogfood` now use isolated OM resource ids (`run-<session>`), reducing cross-task memory bleed.
   - Integration test verifies `run` forwards isolated `resourceId` to backend.
   - One-shot `run` now fails with non-zero exit on backend errors (plus actionable backend-start hint), improving script reliability.
   - Automated dogfood smoke (`bun run dogfood:smoke`) validates `status`, `run "hello"`, and `dogfood --no-verify`.
   - Progress tracker (`bun run dogfood:progress --lookback 30 --target 10`) reports delivery slices (`feat|fix|refactor|test`) for switch gating.
   - Gate command (`bun run dogfood:gate --lookback 30 --target 10`) summarizes smoke + delivery readiness in one pass.
   - Skip-verify gate (`bun run dogfood:gate --skip-verify --lookback 30 --target 10`) enables frequent readiness checks during active iteration.
   - Skip-verify gate hit `ready` on February 21, 2026 with `bun run dogfood:gate --skip-verify --lookback 10 --target 6` (smoke pass, delivery-slices 6/6).
   - Latest run remains `ready` on February 21, 2026 with `bun run dogfood:gate --skip-verify --lookback 10 --target 6` (smoke pass, delivery-slices 7/6).
   - Remaining validation:
   - Complete 6-10 real feature/fix slices in normal flow with Acolyte-first execution and no routine fallback.
   - Exit criteria:
   - Acolyte completes small feature slices end-to-end (plan -> edit -> verify) without fallback.
   - Output stays concise and decision-useful without pseudo-picker noise.
   - Session recovery (`interrupt`, `/new`, `/resume`) remains stable in daily use.
3. Milestone 3: Aggressive Switch Trial (1-2 Days)
   - Exit criteria:
   - 1-2 consecutive days of normal repo development primarily with Acolyte.
   - At least 6-10 real feature/fix slices completed end-to-end with Acolyte.
   - No blocker requiring routine Codex fallback.
   - Cost/latency and memory behavior remain acceptable for daily workflow.

## Switch-To-Acolyte Gate
Move primary development from Codex to Acolyte once these checks pass in a staged trial:
1. Initial gate: 1-2 consecutive days and 6-10 real slices completed with Acolyte.
2. Confirmation gate: optional one-week run after the initial gate to confirm stability.
3. During trial, Codex remains fallback only for true blockers.
4. Reliability: `bun run verify` stays green on every Acolyte-driven slice.
5. Edit clarity: edit previews are readable enough to approve/reject quickly (compact, diff-first, low noise).
6. Recovery: interrupt, resume, and `/new` flows are stable during daily usage.
7. Safety: read/write permission gating prevents accidental writes and is easy to override intentionally.
8. Throughput: Acolyte can complete at least small-to-medium feature slices end-to-end without manual fallback.
9. Cost/latency: response times and token usage stay within acceptable bounds for daily development.

Adoption plan:
1. Start with low-risk chores and test updates.
2. Graduate to normal feature slices on `main`.
3. Keep Codex as fallback only for blocked/high-risk tasks until the gate is consistently met.

### Phase B: Memory Quality
1. Improve observational-memory precision and promotion gates.
2. Add memory transparency/debug tooling.
3. Add evals for repeated-mistake reduction.

### Phase C: Hosted Readiness
1. Harden Vercel + Postgres deployment path.
2. Add backup/restore and multi-machine setup docs.
3. Add operational smoke tests and release process.

## Open Decisions
1. Default model + fallback order by lane (`chat`, `code`, `long-context`, `vision`).
2. Sandbox provider timeline (E2B/Modal).
3. Packaging target (`npm` global vs standalone binary).
4. If/when to evolve from heuristic routing to deeper multi-agent delegation.

## Next Actions (Prioritized)
1. Keep dogfooding on `main` with small validated slices.
2. Continue CLI UX convergence with Codex/Claude patterns while staying minimal.
3. Keep picker wording action-oriented (labels describe concrete outcomes).
4. Keep model/provider routing centralized in one config module.
5. Add regular OM soak runs (`bun run om:soak`) to validate long-running memory behavior under real usage.
6. Tune observational-memory thresholds (cost vs precision).
7. Add token guardrails (hard budgets + compact tool output defaults).
8. Implement lane-based routing and add local-model endpoint support.
9. Keep `docs/features.md` as canonical feature inventory.
10. Evaluate optional git hooks for high-signal checks only.
11. Add staged path for channel adapters post-MVP (not now).

## Risks
1. Memory drift: mitigate with confidence scores + manual correction.
2. Hallucinated repo claims: require tool-grounded evidence.
3. Cost/latency spikes: enforce token budgets + lane routing.
4. Reliability regressions: preserve verify-first workflow and smoke checks.

## Prioritization Policy
1. Correctness/reliability/core workflow over cosmetic polish.
2. If UX polish is deferred, record it explicitly.

## Deferred Improvements
1. Rich Claude-style transcript blocks (`Edit(...)` / `Bash(...)`) with compact excerpts.

## Known Issues
1. A small set of terminal profiles may still emit unmapped `Cmd` key sequences.
