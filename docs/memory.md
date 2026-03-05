# Memory

## Goal

Memory should be invisible and reliable: carry forward important context without user-facing compaction workflows.

## Model

- **Memory Engine**: top-level continuity capability.
- **Memory Pipeline**: staged flow (`ingest -> normalize -> select -> inject -> commit`).
- **Memory Source**: pluggable source that provides entries and optional commit behavior.
- **Memory Source Strategy**: configured source IDs and order (`memorySources`).

## Sources

- `stored`: explicit Markdown memory notes (`user`/`project` scope).
- `distill`: automatic observations + reflections from conversation flow.

Default source order is `stored, distill`.

## Controls

- Request-level off switch: `useMemory=false`
  - disables memory injection for that request
  - skips memory commit for that request
- Config-level off switch: `memoryBudgetTokens=0`
  - disables memory injection globally
  - source strategy config is still retained

## Distill behavior

- Distill writes two record tiers:
  - `observation`: round-level extracted facts
  - `reflection`: consolidated cross-round state
- Load strategy:
  - latest reflection first
  - then post-reflection observations (fresh delta)
- Continuation state:
  - preserve `Current task` and `Next step` when available

## Runtime guarantees

- Commit scheduling is best-effort background work at lifecycle finalize.
- Commits are serialized per session per process through a keyed task queue seam.
- Distill record writes are atomic (`temp file -> rename`) to avoid partial files.

## Storage

- Stored notes: `.acolyte/memory/{user|project}/*.md`
- Distill records: `~/.acolyte/distill/<sessionId>/*.json`

## Extension seams

- Configure source order/enablement with `memorySources`.
- Compose sources via `createMemoryRegistry(sources)`.
- Keep lifecycle contract stable while swapping strategies/storage behind sources.
