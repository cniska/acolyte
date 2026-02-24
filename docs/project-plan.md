# Project Plan

## Goal
Build a reliable, local-first AI coding assistant that can run daily development slices end-to-end (plan -> edit -> verify), with optional hosted mode later.

## Milestones

### Milestone 1: Build Stability Baseline
Status: completed on February 21, 2026.
Description: Lock in quality gates and prevent regressions while core workflows evolve.
Goal: establish a stable implementation baseline with verify-first workflow and smoke coverage.

Exit Criteria:
- `bun run verify` stays green after each slice.
- Smoke checks pass for `status`, `run "hello"`, and OM admin safety.
- No regressions in `/status`, `/permissions`, and `/dogfood`.

### Milestone 2: Dogfooding Readiness
Status: completed on February 24, 2026.
Description: Make the assistant dependable for daily small/medium development slices in this repo.
Goal: reliable day-to-day dogfooding without routine Codex fallback.

Exit Criteria:
- Small feature slices complete end-to-end without fallback.
- Output stays concise and decision-useful.
- Product scope stays coding-first: prioritize code editing/review/test workflows; keep non-coding setup/admin UX minimal.
- Instruction contract stays lean: keep `AGENTS.md` high-signal and minimal; avoid adding verbose style rules that reduce execution success.
- Runtime execution path remains simple and internal by default; no user-facing routing customization unless a concrete workflow requires it.
- Recovery paths (`interrupt`, `/new`, `/resume`) remain stable.
  Evidence: submit-handler regressions cover interrupted turns and timeout recovery to follow-up submit, `/new`, and `/resume`.
- Setup/diagnostics are reliable (`start`/`dev` + `/status` with clear failure guidance).
- Permission flow is explicit and frictionless (read default, write confirm, auto-continue prompt).
- Dogfood smoke validates one real coding edit task end-to-end when provider credentials are ready.
- Track delegated slice success/failure ratio weekly.
  Evidence (February 24, 2026): `bun run dogfood:gate` passed with verify/smoke/recovery green, delivery `23/10`, delegated success rate `96%` over last 30 non-doc commits.

### Milestone 3: Delegated Switch Trial
Status: completed on February 24, 2026.
Description: Move from Codex-led work to gradual delegated slices where the assistant executes bounded tasks end-to-end.
Goal: increase delegated slice success rate while keeping manual fallback fast and explicit.

Exit Criteria:
- 6-10 delegated real feature/fix slices completed end-to-end with verify green.
- Delegated slices are the default path; manual fallback is used only for failed/retry cases.
- No repeat failure class remains without either a root-cause fix or a tracked milestone item.
- Thread/process safety prevents concurrent multi-CLI writes to the same session/thread.
- Cost/latency and memory behavior remain acceptable.
  Evidence (February 24, 2026): `bun run dogfood:gate` passed with delegated slices `16` (feat/fix target `6`) and delegated success rate `96%`, plus recovery/session/concurrency checks green.

### Milestone 4: Runtime Reliability Signals
Status: completed on February 24, 2026.
Description: Make in-flight execution and failures visible, actionable, and low-noise.
Goal: users can always see meaningful progress and failure reasons during execution.

Exit Criteria:
- Tool activity is visible even when progress polling misses events.
- Tool lifecycle remains consistent (`tool_start` -> partial updates -> `tool_end`) so UI state does not desync.
- Duplicate tool-progress rows are suppressed.
- Empty-output failures return actionable guidance (quota/backend/model/provider).
- Permission-blocked writes trigger picker-based recovery, not manual command detours.
- Permission flow stays two-mode for MVP (`read`, `write`); defer finer-grained controls (like `execute`) until post-MVP.
- User-facing diagnostics include per-turn model-call counts and token usage.
- Command diagnostics are consistently system-scoped and scan-friendly (`/status`, `/tokens`, `/sessions`).
- Key-value command outputs preserve readability conventions (dim keys, normal values).
- Session diagnostics survive session switches (`/tokens` restored on `/resume`, reset on `/new`).
- Clarification handling is picker-first (no generated follow-up prompt text before question pickers).
- Persistence guards cover diagnostic continuity (`tokenUsage` normalization tested at storage layer).
- Single-agent execution remains the default path and should stay reliable under repeated dogfood use.
- Critical operator actions stay explicit and command-first.
- Absolute-path safety guards avoid false positives on non-path slash tokens in prompts (for example `/xyz` in examples).
  Evidence (February 24, 2026): `bun run dogfood:gate` passed with verify/smoke/recovery/one-shot-diagnostics/session-diagnostics green, plus delivery and delegated-success-rate checks.

### Milestone 5: Autonomous Delivery Readiness (MVP Closure)
Status: in progress.
Description: Prove the assistant can complete real coding tasks independently with low fallback.
Goal: make autonomous end-to-end execution reliable enough to call MVP complete.

Exit Criteria:
- Independent delegated coding tasks succeed consistently over a sustained window (not single-run).
- Manual fallback is the exception path, not the default path.
- Failure categories are tracked, and repeated classes are closed with root-cause fixes.
- Gate evidence remains green while real task execution stays stable.
- MVP gate is only marked complete when this milestone is complete.
  Current evidence (February 24, 2026): `dogfood:smoke` now requires two autonomous coding edits when provider is ready, and `bun run dogfood:gate` is green with recovery/diagnostics/concurrency/delegated checks; `--strict-autonomy` raises delegated thresholds and requires a 3-run stability window (currently 1/3).

### Milestone 6: Memory Quality
Status: planned.
Description: Improve quality and trustworthiness of persistent memory.
Goal: reduce repeated mistakes with transparent, correctable memory behavior.

Exit Criteria:
- Observational memory promotion/precision is tuned for daily coding use.
- Memory context is inspectable and easy to correct.
- Evals show reduction in repeated instruction failures.

### Milestone 7: Hosted Readiness
Status: planned.
Description: Prepare optional hosted mode for centralized memory and multi-device continuity.
Goal: enable safe, reliable hosted operation without degrading local-first UX.

Exit Criteria:
- Vercel + Postgres path is hardened and documented.
- Hosted session APIs support create/list/load/update flows.
- CLI supports hybrid local/remote session storage.
- Auth baseline is in place (GitHub-first).

### Milestone 8: Post-MVP Friends and Family
Status: planned.
Description: Share with trusted coder friends to gather real-world feedback while continuing rapid iteration.
Goal: validate usability, reliability, and core workflow fit before public release.

Exit Criteria:
- MVP gate is met (Milestones 2-5 stable).
- 5-10 external users complete real tasks and share structured feedback.
- Top rough edges from early feedback are prioritized and addressed.
- Core onboarding remains simple and repeatable.
- Setup/distribution polish deferred earlier (global install UX, onboarding wizard polish, OAuth setup flow) is production-ready.

### Milestone 9: Public OSS Release
Status: planned.
Description: Open-source core local mode after friends-and-family feedback is incorporated.
Goal: ship a clean OSS local-first release with optional self-host path.

Exit Criteria:
- Friends-and-family phase is complete with major blockers resolved.
- Public quickstart and self-host docs are ready.
- OSS vs managed boundaries are clearly documented.

## Known Issues
- Progress/status contracts were simplified to a single-agent, single-model shape (`model`, `provider`, `provider_ready`) plus `Working…` stage text.

## MVP Gate
- Status: not yet met.
- Completed milestones retained: 1-4 are complete.
- Remaining requirement: complete Milestone 5 (autonomous independent task execution with low fallback).
