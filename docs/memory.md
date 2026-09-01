# Memory

Acolyte memory preserves durable context across coding sessions through scoped observations and on-demand recall.

## Design

Memory is small, scoped, and retrievable. The model decides when to search it, and the distiller keeps only facts that would be costly to rediscover. Conversation history and tool output remain transcript data; memory holds durable facts about the work and the person doing it.

```text
Turn and task activity
  -> distiller
  -> scoped observation and embedding
  -> on-demand recall in a later turn
```

## Records and scopes

Memory has two record kinds:

- **Stored** — A fact written straight to the store rather than distilled from work.
- **Observation** — A fact extracted from completed work by the distiller.

Each record belongs to one scope:

| Scope | Holds | Visible to |
|---|---|---|
| `session` | In-progress state and temporary constraints | The current session only |
| `project` | Architecture, tooling, conventions, and decisions | Sessions in the current project |
| `user` | Preferences that follow the user across projects | Every session |

The canonical resource IDs are `sess_*`, `proj_*`, and `user_*`.

A project is identified by the `owner/repo` its `upstream` remote names, or its `origin` when there is no `upstream`, lowercased and hashed into the key. Every clone and worktree of that repository reaches the same project memory, whether the remote is addressed over SSH or HTTPS and whichever forge hosts it. A fork keeps the project it contributes to, since `upstream` names the repository it was forked from; a fork with no `upstream` remote is its own project. The readable name is stored beside the key rather than inside it, so a key stays an opaque identifier.

With cloud sync on, Acolyte tells the account what the current workspace's project is called, since a key on its own is opaque there. Nothing else names a scope: a project whose checkout is gone keeps its key.

The user scope is the account, not the machine: signed in it is keyed by the subject of the cloud token, so every machine signed into one account reaches one user scope; signed out every machine uses `user_local`. Signing in moves `user_local` into the account and reports what moved — see [Cloud](cloud.md). While signed out, what the account holds is out of reach.

A workspace whose repository has no remote naming an `owner/repo` has no project scope, and a remote addressing a filesystem path names none. Session and user memory work there as usual. An explicit project-scoped write reports that the workspace has no remote; distillation has nowhere to commit, so it records the skip in the trace.

## Writing memory

After a completed request, the distiller examines the new conversation content and a task-activity digest. The digest records files changed, commands run and whether they failed, and other tool failures, so durable work facts can survive when the final response omits them.

The distiller writes observations through `memory-observe(scope, content, topic?)`. A useful observation is one self-contained claim about the work that cannot be recovered by reading the code: a decision and its reason, a discovered constraint, a project convention, or a user preference. Volatile details such as line numbers, file listings, and unrealized intentions do not belong in memory.

Observations are deduplicated within their scope and receive an embedding. A `topic` is an optional single-word label, such as `testing`, `auth`, or `config`.

Before writing, the distiller can inspect relevant existing records without marking them as recalled. It may write nothing, or write a sharper, corrected, merged, or split successor. A successor retires only records the distiller was shown, in its own scope, and only after the successor was stored.

## Recalling memory

The model calls `memory-search` when prior context is useful. Durable memory is never injected wholesale into the system prompt.

Recall first limits records to scopes the caller could write. It then ranks them with cosine similarity and TF-IDF weighted token overlap. Topic embedding matches narrow the candidate set when enough matching records exist; otherwise recall uses the full visible corpus. A missing query embedding returns a classified error rather than a partially ranked result.

The SQLite and cloud backends use the same hybrid ranking policy. The cloud backend uses pgvector to pre-filter candidates before applying token-overlap re-ranking.

Embedding requests use the selected provider. An `embeddingBaseUrl` routes only embeddings to an OpenAI-compatible API; its credential comes from `ACOLYTE_EMBEDDING_API_KEY` or the private credentials file, never project configuration. See [Configuration](configuration.md) for provider setup.

## Retirement and restore

Retirement moves a record from the active set to `memory_archive` and drops its embedding. It never destroys the record; `/memory rm` is the only destructive memory operation.

| Disposition | Meaning |
|---|---|
| `superseded` | One or more successor records replaced it. The archive records every successor ID. |
| `capacity` | The record left under capacity pressure. |
| `noise` | The record was judged not to be a durable fact. |

Archived records are excluded from active listing and recall. Restoring a record returns it to the active set and regenerates its embedding.

Distillation retires records when fresh work establishes a sharper, corrected, merged, or split successor.

Use `/memory [scope] --archived` or `acolyte memory list [scope] --archived` to inspect the archive, and `acolyte memory restore <id>...` to restore records. Debug events include `memory.retire` and `memory.restore`.

## Runtime behavior

- **Best effort** — distillation runs in lifecycle finalize and cannot delay or fail the user-facing response.
- **Serialization** — commits for a session and durable scope are serialized in-process through a keyed queue.
- **Observability** — lifecycle debug events record memory loads and commits; commit metrics include promotion, supersession, candidate, and token counts.
- **Storage** — writes use the configured backend for atomic persistence.

## Storage

Memory uses SQLite by default: `memory.db` in the data directory, with `memories` and `memory_embeddings` tables, BLOB vectors, and WAL mode. With the `cloudSync` feature flag, it uses the cloud Postgres and pgvector backend configured by `acolyte login`. See [Paths](paths.md) and [Cloud](cloud.md).

## Benchmarks
Measured on LoCoMo, 10 conversations, 1,650 queries, and 2,541 observations with `text-embedding-3-small`:

| Configuration | R@5 | NDCG@5 |
|---|---:|---:|
| Pure cosine, raw turns | 0.599 | 0.480 |
| Pure cosine, observations | 0.650 | 0.580 |
| Hybrid scoring | 0.669 | 0.602 |
| Hybrid + TF-IDF | 0.705 | 0.651 |
| Hybrid + TF-IDF (large model) | 0.722 | 0.652 |

Input quality from distillation accounts for a larger gain than any retrieval algorithm. The harness is `scripts/run-memory-bench.ts`; its scenarios are in `scripts/memory-bench-scenarios.ts`.

## Key files

- `src/memory-contract.ts` — memory schemas, records, scopes, and storage contract.
- `src/memory-ops.ts` — user-facing memory operations.
- `src/memory-distiller.ts` — observation prompt and commit pipeline.
- `src/memory-recall.ts` — scope filtering and hybrid ranking.
- `src/memory-toolkit.ts` — model-facing search and add tools.
- `src/memory-store.ts` — SQLite store and store factory.
- `src/cloud-client.ts` — feature-flagged cloud store.
- `src/memory-embedding.ts` — embedding, scoring, and topic filtering.

## Further reading

[Nothing Forgotten](https://crisu.me/blog/nothing-forgotten) explains why context compaction is the wrong model for AI memory.
