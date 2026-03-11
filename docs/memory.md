# Memory

## Goal

Memory should be invisible and reliable: carry forward important context without user-facing compaction workflows.
Distill preserves durable knowledge; history pruning handles bulky transcript/tool-output payloads.

## Model

- **Memory Engine**: top-level continuity capability.
- **Memory Pipeline**: staged flow (`ingest →normalize →select →inject →commit`).
- **Memory Source**: pluggable source that provides entries and optional commit behavior.
- **Memory Source Strategy**: configured source IDs and order (`memorySources`).
- **Resource ID**: canonical cross-session identity key (`proj_*` or `user_*`) used for resource-scoped memory.

## Sources

- `stored`: explicit Markdown memory notes (`user`/`project` scope).
- `distill_user`: cross-session user distill context.
- `distill_project`: cross-session project distill context (workspace-keyed).
- `distill_session`: session distill context (active session continuity).

Default source order is `stored, distill_project, distill_user, distill_session`.

## Controls

- Request-level off switch: `useMemory=false`
  - disables memory injection for that request
  - skips memory commit for that request
- Config-level off switch: `memoryBudgetTokens=0`
  - disables memory injection globally
  - source strategy config is still retained

## Inspiration

The observation/reflection model is inspired by [Mastra's Observational Memory](https://mastra.ai/docs/memory/observational-memory), which uses background Observer and Reflector agents to compress conversation history into a dense observation log. Acolyte adapts this idea into a 3-tier distill pipeline with explicit scope promotion instead of threshold-based compression.

## Distill behavior

- Distill writes two record tiers:
  - `observation`: round-level extracted facts
  - `reflection`: consolidated cross-round state
- Commit scopes:
  - `session` (active session continuity)
  - `project` (workspace continuity across sessions)
  - `user` (global user continuity across sessions)
- Promotion model:
  - `distill_session` commit is automatic.
  - Observation lines tagged `[project]` promote to project scope.
  - Observation lines tagged `[user]` promote to user scope.
  - Session/continuation lines stay in session scope.
  - Untagged fact lines are dropped (strict tagged promotion, no fallback).
  - Malformed bracket tags (for example `[proj]`) reject the entire session observation batch.
- Load strategy:
  - latest reflection first
  - then post-reflection observations (fresh delta, newest first)
- Continuation state:
  - preserve `Current task` and `Next step` when available
  - continuation is sourced from typed fields (`currentTask`/`nextStep`)

## Runtime guarantees

- Commit scheduling is best-effort background work at lifecycle finalize.
- Commits are serialized per session per process through a keyed task queue seam.
- Selection keeps one continuation state (`Current task`, `Next step`) based on source-provided continuation metadata, choosing the freshest that fits budget.
- Soul prompt injection adds an explicit resume block from structured continuation state when available.
- Agent input assembly applies deterministic rolling history fitting (newest-first, truncate-to-fit under remaining budget).
- Aggressive old-turn compaction is driven by typed message metadata (`kind: tool_payload`), not regex heuristics.
- Debug observability uses lifecycle-scoped events (`lifecycle.memory.load_*`, `lifecycle.memory.commit_*`) through standard debug channels.
- Commit debug includes promotion counters (`project_promoted_facts`, `user_promoted_facts`, `session_scoped_facts`, `dropped_untagged_facts`, `malformed_tagged_facts`).
- Repeated malformed-tag rejects emit `lifecycle.memory.quality_warning` with `malformed_reject_streak`.
- Server runtime emits a dedicated `memory quality warning` log line for `lifecycle.memory.quality_warning` events.
- Selection dedupes identical entry content to avoid wasting budget on repeats.
- Normalization drops blank entries before selection.
- Distill record writes are atomic (`temp file →rename`) to avoid partial files.

## Storage

- Stored notes: `.acolyte/memory/{user|project}/*.md`
- Distill records: `~/.acolyte/distill/<scopeKey>/*.json` where `<scopeKey>` is `sess_*`, `proj_*`, or `user_*`.

## Extension seams

- Configure source order/enablement with `memorySources`.
- Compose sources and strategies via `createMemoryRegistry(sources, normalizeEntries, selectEntries)`.
- Pipeline stage seams:
  - `MemoryNormalizeStrategy`
  - `MemorySelectionStrategy`
- Keep lifecycle contract stable while swapping strategies/storage behind sources.
