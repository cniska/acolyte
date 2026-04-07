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
- **Memory Distiller**: extracts and commits observations from conversations after each request
- **Resource ID**: canonical cross-session identity key (`proj_*` or `user_*`) used for resource-scoped memory

### On-demand access

The model uses the memory toolkit to search for relevant context when it determines it needs it. Memory is not injected into the system prompt.

## Sources

The observer runs after each request and promotes facts to the appropriate scope via `@observe` directives.

Memory kinds in storage: `stored` (explicit user/tool-created), `observation` (distill-extracted facts).

## Controls

- Request-level off switch: `useMemory=false`
  - Skips memory commit for that request
  - Memory toolkit tools remain available (on-demand access is not gated)

## Inspiration

The observation model is inspired by [Mastra's Observational Memory](https://mastra.ai/docs/memory/observational-memory). Acolyte adapts this idea with explicit scope promotion via `@observe` directives and on-demand retrieval via the memory toolkit.

## Distill behavior

- the observer extracts facts from conversations, one per `@observe` directive
- each fact is stored as an individual observation record with its own embedding
- scope promotion via `@observe` directives:
  - `@observe project` — project-scoped facts (architecture, tooling, conventions)
  - `@observe user` — user-scoped facts (preferences that carry across projects)
  - `@observe session` — session-scoped facts (in-progress state, temporary constraints)
  - if a preference is project-scoped, use `@observe project` not `@observe user`
  - untagged lines are dropped (strict directive promotion, no fallback)
  - malformed directives (e.g. `@observe proj`) are silently dropped and logged
- dedup: exact duplicate observations are skipped at write time

## Runtime guarantees

- commit scheduling is best-effort background work at lifecycle finalize
- commits are serialized per session per process through a keyed task queue seam
- agent input assembly applies deterministic rolling history fitting (newest-first, truncate-to-fit under remaining budget)
- aggressive old-turn compaction is driven by typed message metadata (`kind: tool_payload`), not regex heuristics
- debug observability uses lifecycle-scoped events (`lifecycle.memory.load_*`, `lifecycle.memory.commit_*`) through standard debug channels
- commit debug includes promotion counters (`project_promoted_facts`, `user_promoted_facts`, `session_scoped_facts`, `dropped_untagged_facts`)
- repeated malformed-directive drops emit `lifecycle.memory.quality_warning` with `malformed_reject_streak` after 3 consecutive commits
- distill record writes use the configured storage backend (SQLite or Postgres) for atomic persistence
- semantic recall: memory records are embedded at write time using the provider embedding API. At query time, the SQLite backend scores entries by a weighted blend of cosine similarity (0.8) and token overlap (0.2). The Postgres backend uses native pgvector cosine distance (`<=>` operator) for similarity search. Records without embeddings fall back to recency ordering

## Storage

Two backends, selected via the `postgresMemory` feature flag (default: SQLite):

- **SQLite** (default): `~/.acolyte/memory.db`, `memories` + `memory_embeddings` tables, BLOB vectors, WAL mode
- **Postgres + pgvector** (feature-flagged): configured via `postgresUrl`, `vector(1536)` column type, native cosine distance search. Bring your own Postgres — Acolyte does not provision or manage the database.

## Extension seams

- compose sources via `createMemoryRegistry()`
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
- `src/memory-store.ts` — SQLite-backed MemoryStore implementation and store factory
- `src/memory-store-postgres.ts` — Postgres + pgvector MemoryStore implementation (feature-flagged)
- `src/memory-distiller.ts` — memory distiller, observer prompt, commit pipeline
- `src/memory-toolkit.ts` — on-demand memory tools (search, add, remove)
- `src/memory-embedding.ts` — provider embedding API wrapper and cosine similarity

## Further reading

[Nothing Forgotten](https://crisu.me/blog/nothing-forgotten) — why context compaction is the wrong approach to AI memory
