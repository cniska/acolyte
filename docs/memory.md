# Memory

## Goal

Memory should be invisible and reliable: carry forward important context without user-facing compaction workflows.
Distill preserves durable knowledge; history pruning handles bulky transcript/tool-output payloads.

## Model

- **Memory Engine**: top-level continuity capability
- **Memory Pipeline**: staged flow:

```text
ingest → normalize → commit
```

- **Memory Toolkit**: on-demand tools (`memory-search`, `memory-add`, `memory-remove`) that the model invokes when it needs context instead of upfront injection
- **Memory Source**: pluggable source that provides commit behavior
- **Resource ID**: canonical cross-session identity key (`proj_*` or `user_*`) used for resource-scoped memory

### On-demand access

Memory is no longer injected into the system prompt. Instead, the model uses the memory toolkit to search for relevant context when it determines it needs it. This replaces the previous injection-based model where memory was loaded and inserted into every request upfront.

## Sources

Default commit sources are `distill_session`, `distill_project`, `distill_user`.

- `distill_session`: session distill context (active session continuity)
- `distill_project`: cross-session project distill context (workspace-keyed)
- `distill_user`: cross-session user distill context

Memory kinds in storage: `stored` (explicit user/tool-created), `observation` (distill round-level facts), `reflection` (distill consolidated state).

## Controls

- Request-level off switch: `useMemory=false`
  - Skips memory commit for that request
  - Memory toolkit tools remain available (on-demand access is not gated)
- `memory.budgetTokens`: legacy config, no longer used for injection

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
- continuation state (`Current task`, `Next step`) is available through the memory toolkit when the model searches for it
- agent input assembly applies deterministic rolling history fitting (newest-first, truncate-to-fit under remaining budget)
- aggressive old-turn compaction is driven by typed message metadata (`kind: tool_payload`), not regex heuristics
- debug observability uses lifecycle-scoped events (`lifecycle.memory.load_*`, `lifecycle.memory.commit_*`) through standard debug channels
- commit debug includes promotion counters (`project_promoted_facts`, `user_promoted_facts`, `session_scoped_facts`, `dropped_untagged_facts`)
- repeated malformed-tag drops emit `lifecycle.memory.quality_warning` with `malformed_reject_streak` after 3 consecutive commits with malformed tags
- selection dedupes identical entry content to avoid wasting budget on repeats
- normalization drops blank entries before selection
- distill record writes use SQLite with WAL mode for atomic persistence
- semantic recall: memory records are embedded at write time using the provider embedding API. At query time, the search query is embedded and entries are ranked by cosine similarity. Records without embeddings fall back to recency ordering

## Storage

- all memories: `~/.acolyte/memory.db` (SQLite, `memories` table, keyed by `scope_key`: `sess_*`, `proj_*`, or `user_*`)
- embeddings: `memory_embeddings` table in `memory.db` (BLOB vectors, keyed by `id`)

## Extension seams

- compose sources and strategies via `createMemoryRegistry()`
- pipeline stage seams:
  - `MemoryNormalizeStrategy`
- keep lifecycle contract stable while swapping strategies/storage behind sources

## Memory toolkit

The memory toolkit (`memory-toolkit.ts`) exposes three tools:

- **memory-search**: search stored memories by query, with optional scope filter. Uses semantic ranking when embeddings are available.
- **memory-add**: add a new stored memory with content and scope (`user` or `project`).
- **memory-remove**: remove a stored memory by ID.

These tools are the primary interface for the model to access and manage memory at runtime.

## Key files

- `src/memory-ops.ts` — top-level memory operations (list, add, remove)
- `src/memory-contract.ts` — type definitions for entries, scopes, records, and MemoryStore interface
- `src/memory-store.ts` — SQLite-backed MemoryStore implementation and singleton factory
- `src/memory-pipeline.ts` — staged pipeline (ingest, normalize, commit)
- `src/memory-registry.ts` — source composition and pipeline orchestration
- `src/memory-source-distill.ts` — distill memory source with observer and reflector agents
- `src/memory-toolkit.ts` — on-demand memory tools (search, add, remove)
- `src/memory-distill-prompts.ts` — observer and reflector prompt templates
- `src/memory-embedding.ts` — provider embedding API wrapper and cosine similarity

## Further reading

[Nothing Forgotten](https://crisu.me/blog/nothing-forgotten) — why context compaction is the wrong approach to AI memory
