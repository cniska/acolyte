# Memory

## Goal

Memory should be invisible and reliable: carry forward important context without user-facing compaction workflows.
Distill preserves durable knowledge; history pruning handles bulky transcript/tool-output payloads.

## Model

- **Memory Engine**: top-level continuity capability
- **Memory Pipeline**: staged flow:

```text
ingest → normalize → select → inject → commit
```

- **Memory Source**: pluggable source that provides entries and optional commit behavior
- **Memory Source Strategy**: configured source IDs and order (`memorySources`)
- **Resource ID**: canonical cross-session identity key (`proj_*` or `user_*`) used for resource-scoped memory

## Sources

- `stored`: explicit stored memories (`user`/`project` scope, kind `stored`)
- `distill_user`: cross-session user distill context
- `distill_project`: cross-session project distill context (workspace-keyed)
- `distill_session`: session distill context (active session continuity)

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

- distill writes two record kinds:
  - `observation`: round-level extracted facts
  - `reflection`: consolidated cross-round state
- commit scopes:
  - `session` (active session continuity)
  - `project` (workspace continuity across sessions)
  - `user` (global user continuity across sessions)
- promotion model:
  - `distill_session` commit is automatic
  - observation lines tagged `[project]` promote to project scope
  - observation lines tagged `[user]` promote to user scope
  - session/continuation lines stay in session scope
  - untagged fact lines are dropped (strict tagged promotion, no fallback)
  - malformed bracket tags (for example `[proj]`) are silently dropped and logged
- load strategy:
  - latest reflection first
  - then post-reflection observations (fresh delta, newest first)
- continuation state:
  - preserve `Current task` and `Next step` when available
  - continuation is sourced from typed fields (`currentTask`/`nextStep`)

## Runtime guarantees

- commit scheduling is best-effort background work at lifecycle finalize
- commits are serialized per session per process through a keyed task queue seam
- selection keeps one continuation state (`Current task`, `Next step`) based on source-provided continuation metadata, choosing the freshest that fits budget
- soul prompt injection adds an explicit resume block from structured continuation state when available
- agent input assembly applies deterministic rolling history fitting (newest-first, truncate-to-fit under remaining budget)
- aggressive old-turn compaction is driven by typed message metadata (`kind: tool_payload`), not regex heuristics
- debug observability uses lifecycle-scoped events (`lifecycle.memory.load_*`, `lifecycle.memory.commit_*`) through standard debug channels
- commit debug includes promotion counters (`project_promoted_facts`, `user_promoted_facts`, `session_scoped_facts`, `dropped_untagged_facts`)
- repeated malformed-tag drops emit `lifecycle.memory.quality_warning` with `malformed_reject_streak` after 3 consecutive commits with malformed tags
- selection dedupes identical entry content to avoid wasting budget on repeats
- normalization drops blank entries before selection
- distill record writes use SQLite with WAL mode for atomic persistence
- semantic recall: memory records are embedded at write time using the provider embedding API. At query time, the user's message is embedded and entries are ranked by cosine similarity. Records without embeddings fall back to recency ordering. Continuation entries always rank first

## Storage

- all memories: `~/.acolyte/memory.db` (SQLite, `memories` table, keyed by `scope_key`: `sess_*`, `proj_*`, or `user_*`)
- embeddings: `memory_embeddings` table in `memory.db` (BLOB vectors, keyed by `id`)

## Extension seams

- configure source order/enablement with `memorySources`
- compose sources and strategies via `createMemoryRegistry(sources, normalizeEntries, selectEntries)`
- pipeline stage seams:
  - `MemoryNormalizeStrategy`
  - `MemorySelectionStrategy`
- keep lifecycle contract stable while swapping strategies/storage behind sources

## Key files

- `src/memory-ops.ts` — top-level memory operations (list, add, remove)
- `src/memory-contract.ts` — type definitions for entries, scopes, records, and MemoryStore interface
- `src/memory-store.ts` — SQLite-backed MemoryStore implementation and singleton factory
- `src/memory-pipeline.ts` — staged pipeline (ingest, normalize, select, inject, commit)
- `src/memory-registry.ts` — source composition, strategy injection, and pipeline orchestration
- `src/memory-source-distill.ts` — distill memory source with observer and reflector agents
- `src/memory-source-stored.ts` — stored memory source
- `src/memory-distill-prompts.ts` — observer and reflector prompt templates
- `src/memory-embedding.ts` — provider embedding API wrapper and cosine similarity

## Further reading

[Nothing Forgotten](https://crisu.me/blog/nothing-forgotten) — why context compaction is the wrong approach to AI memory
