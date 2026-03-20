# Memory

## Goal

Memory should be invisible and reliable: carry forward important context without user-facing compaction workflows.
Distill preserves durable knowledge; history pruning handles bulky transcript/tool-output payloads.

## Model

- **Memory Engine**: top-level continuity capability.
- **Memory Pipeline**: staged flow:

```text
ingest → normalize → select → inject → commit
```

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
  - Disables memory injection for that request
  - Skips memory commit for that request
- Config-level off switch: `memoryBudgetTokens=0`
  - Disables memory injection globally
  - Source strategy config is still retained

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
  - Malformed bracket tags (for example `[proj]`) are silently dropped and logged.
- Load strategy:
  - Latest reflection first
  - Then post-reflection observations (fresh delta, newest first)
- Continuation state:
  - Preserve `Current task` and `Next step` when available
  - Continuation is sourced from typed fields (`currentTask`/`nextStep`)

## Runtime guarantees

- Commit scheduling is best-effort background work at lifecycle finalize.
- Commits are serialized per session per process through a keyed task queue seam.
- Selection keeps one continuation state (`Current task`, `Next step`) based on source-provided continuation metadata, choosing the freshest that fits budget.
- Soul prompt injection adds an explicit resume block from structured continuation state when available.
- Agent input assembly applies deterministic rolling history fitting (newest-first, truncate-to-fit under remaining budget).
- Aggressive old-turn compaction is driven by typed message metadata (`kind: tool_payload`), not regex heuristics.
- Debug observability uses lifecycle-scoped events (`lifecycle.memory.load_*`, `lifecycle.memory.commit_*`) through standard debug channels.
- Commit debug includes promotion counters (`project_promoted_facts`, `user_promoted_facts`, `session_scoped_facts`, `dropped_untagged_facts`).
- Repeated malformed-tag drops emit `lifecycle.memory.quality_warning` with `malformed_reject_streak` after 3 consecutive commits with malformed tags.
- Selection dedupes identical entry content to avoid wasting budget on repeats.
- Normalization drops blank entries before selection.
- Distill record writes use SQLite with WAL mode for atomic persistence.
- Semantic recall: distill records are embedded at write time using the provider embedding API. At query time, the user's message is embedded and entries are ranked by cosine similarity. Records without embeddings fall back to recency ordering. Continuation entries always rank first.

## Storage

- Stored notes: `.acolyte/memory/{user|project}/*.md`
- Distill records: `~/.acolyte/memory.db` (SQLite, keyed by `scope_key`: `sess_*`, `proj_*`, or `user_*`).
- Embeddings: `distill_embeddings` table in `memory.db` (BLOB vectors, keyed by `record_id`).

## Extension seams

- Configure source order/enablement with `memorySources`.
- Compose sources and strategies via `createMemoryRegistry(sources, normalizeEntries, selectEntries)`.
- Pipeline stage seams:
  - `MemoryNormalizeStrategy`
  - `MemorySelectionStrategy`
- Keep lifecycle contract stable while swapping strategies/storage behind sources.

## Key files

- `src/memory.ts` — Top-level memory operations (list, add, remove).
- `src/memory-contract.ts` — Type definitions for entries, scopes, and distill records.
- `src/memory-pipeline.ts` — Staged pipeline (ingest, normalize, select, inject, commit).
- `src/memory-registry.ts` — Source composition, strategy injection, and pipeline orchestration.
- `src/memory-source-distill.ts` — Distill memory source with observer and reflector agents.
- `src/memory-source-stored.ts` — Stored markdown memory source.
- `src/memory-distill-prompts.ts` — Observer and reflector prompt templates.
- `src/memory-distill-store.ts` — SQLite-based distill record and embedding persistence.
- `src/memory-embedding.ts` — Provider embedding API wrapper and cosine similarity.
- `src/memory-store.ts` — Memory store interface for list, add, and remove.
