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
Status: in progress.
Description: Make the assistant dependable for daily small/medium development slices in this repo.
Goal: reliable day-to-day dogfooding without routine Codex fallback.

Exit Criteria:
- Small feature slices complete end-to-end without fallback.
- Output stays concise and decision-useful.
- Instruction contract stays lean: keep `AGENTS.md` high-signal and minimal; avoid adding verbose style rules that reduce execution success.
- Role/mode routing remains automatic and internal by default; no user-facing routing customization unless a concrete workflow requires it.
- Recovery paths (`interrupt`, `/new`, `/resume`) remain stable.
- Setup/diagnostics are reliable (`start`/`dev` + `/status` with clear failure guidance).
- Permission flow is explicit and frictionless (read default, write confirm, auto-continue prompt).
- Track delegated slice success/failure ratio weekly.

### Milestone 3: Delegated Switch Trial
Status: planned.
Description: Move from Codex-led work to gradual delegated slices where the assistant executes bounded tasks end-to-end.
Goal: increase delegated slice success rate while keeping manual fallback fast and explicit.

Exit Criteria:
- 6-10 delegated real feature/fix slices completed end-to-end with verify green.
- Delegated slices are the default path; manual fallback is used only for failed/retry cases.
- No repeat failure class remains without either a root-cause fix or a tracked milestone item.
- Thread/process safety prevents concurrent multi-CLI writes to the same session/thread.
- Cost/latency and memory behavior remain acceptable.

### Milestone 4: Runtime Reliability Signals
Status: in progress.
Description: Make in-flight execution and failures visible, actionable, and low-noise.
Goal: users can always see meaningful progress and failure reasons during execution.

Exit Criteria:
- Tool activity is visible even when progress polling misses events.
- Tool lifecycle remains consistent (`tool_start` -> partial updates -> `tool_end`) so UI state does not desync.
- Duplicate tool-progress rows are suppressed.
- Empty-output failures return actionable guidance (quota/backend/model/provider).
- Permission-blocked writes trigger picker-based recovery, not manual command detours.
- Permission policies support category-level control (`read`, `edit`, `execute`) with session-scoped “always allow” grants.
- User-facing diagnostics include per-turn model-call counts and token usage.
- Critical operator actions stay explicit and command-first.

### Milestone 5: Memory Quality
Status: planned.
Description: Improve quality and trustworthiness of persistent memory.
Goal: reduce repeated mistakes with transparent, correctable memory behavior.

Exit Criteria:
- Observational memory promotion/precision is tuned for daily coding use.
- Memory context is inspectable and easy to correct.
- Evals show reduction in repeated instruction failures.

### Milestone 6: Hosted Readiness
Status: planned.
Description: Prepare optional hosted mode for centralized memory and multi-device continuity.
Goal: enable safe, reliable hosted operation without degrading local-first UX.

Exit Criteria:
- Vercel + Postgres path is hardened and documented.
- Hosted session APIs support create/list/load/update flows.
- CLI supports hybrid local/remote session storage.
- Auth baseline is in place (GitHub-first).

### Milestone 7: Post-MVP Friends and Family
Status: planned.
Description: Share with trusted coder friends to gather real-world feedback while continuing rapid iteration.
Goal: validate usability, reliability, and core workflow fit before public release.

Exit Criteria:
- MVP gate is met (Milestones 2-4 stable).
- 5-10 external users complete real tasks and share structured feedback.
- Top rough edges from early feedback are prioritized and addressed.
- Core onboarding remains simple and repeatable.
- Setup/distribution polish deferred earlier (global install UX, onboarding wizard polish, OAuth setup flow) is production-ready.

### Milestone 8: Public OSS Release
Status: planned.
Description: Open-source core local mode after friends-and-family feedback is incorporated.
Goal: ship a clean OSS local-first release with optional self-host path.

Exit Criteria:
- Friends-and-family phase is complete with major blockers resolved.
- Public quickstart and self-host docs are ready.
- OSS vs managed boundaries are clearly documented.

## Known Issues
- Mastra Studio agent metadata currently reports `gpt-5-mini` for all agents, even when runtime role routing uses configured models correctly (for example coder uses `openai/gpt-5-codex`).
