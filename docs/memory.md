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
- distill record writes use the configured storage backend for atomic persistence
- hybrid recall: entries scored by cosine similarity + TF-IDF weighted token overlap (see below). Falls back to recency when embeddings are unavailable

## Recall

Memory records are embedded at write time using the provider embedding API. At query time, entries are scored by a weighted blend of two signals:

- **Cosine similarity** (weight 0.8) — semantic relevance via embedding distance
- **TF-IDF token overlap** (weight 0.2) — exact keyword matching where rare tokens like proper nouns and tool names score higher than common words

Both the local SQLite and cloud backends use this hybrid scoring. The cloud path uses native pgvector cosine distance to pre-filter candidates, then applies token overlap to re-rank the shortlist.

When observations have topic tags (assigned via `@topic` in the distiller), the search pipeline filters to matching topics before scoring. Topic matching uses embedding similarity between the query and stored topic labels. If the filtered set is too small, the pipeline falls back to the full corpus.

Weights and thresholds are defined in `MemoryPolicy` (`cosineWeight`, `tokenWeight`, `topicThreshold`, `minTopicFilterSize`).

### Benchmark results

Measured on LoCoMo (10 conversations, 1650 queries, 2541 observations) with `text-embedding-3-small`:

| Configuration | R@5 | NDCG@5 |
|---|---|---|
| Pure cosine, raw turns | 0.599 | 0.480 |
| Pure cosine, observations | 0.650 | 0.580 |
| Hybrid scoring | 0.669 | 0.602 |
| Hybrid + TF-IDF | 0.705 | 0.651 |
| Hybrid + TF-IDF (large model) | 0.722 | 0.652 |

Input quality (distillation) accounts for a larger gain than any retrieval algorithm.

Harness: `scripts/run-memory-bench.ts`. Adapters: `scripts/memory-bench-scenarios.ts`.

## Storage

Two backends, selected via the `cloudSync` feature flag (default: SQLite):

- **SQLite** (default): `~/.acolyte/memory.db`, `memories` + `memory_embeddings` tables, BLOB vectors, WAL mode
- **Cloud** (feature-flagged): configured via `cloudUrl` + `cloudToken`, backed by Postgres + pgvector. See [Cloud](cloud.md).

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
- `src/cloud-client.ts` — cloud API MemoryStore implementation (feature-flagged)
- `src/memory-distiller.ts` — memory distiller, observer prompt, commit pipeline
- `src/memory-toolkit.ts` — on-demand memory tools (search, add, remove)
- `src/memory-embedding.ts` — provider embedding API wrapper, cosine similarity, TF-IDF, and topic filtering

## Further reading

[Nothing Forgotten](https://crisu.me/blog/nothing-forgotten) — why context compaction is the wrong approach to AI memory
