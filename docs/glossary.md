# Glossary

Ubiquitous language and naming rules used across Acolyte code and docs.

## Naming rules

- **Domain noun** (`Session`, `Task`): in-memory domain entity used by core logic.
- **`*Record`** (`SessionRecord`, `TaskRecord`): one persisted entity record.
- **`*Entry`** (`MemoryContextEntry`, queue entry): one runtime/pipeline item (non-persisted by default).
- **`*State`** (`SessionState`): aggregate runtime/persisted state container.
- **`*Contract`** (`TaskContract`, `StatusContract`): boundary shape for protocol/config/transport.
- **`*Store`** (`SessionStore`, `TaskStore`): behavior interface for persistence operations.
- **`*Schema`** (`sessionSchema`, `taskSchema`): Zod runtime validator and source of truth for unions.
- **`*Input` / `*Output`**: operation-specific payload types.

## Documentation language rules

- Describe guarantees by **boundary/semantics** (for example, `per-process`, `per-session`, `per-request`).
- Avoid deployment-shape wording (`single daemon`, `multi daemon`, `replica`) unless deployment topology itself is the subject.
- Keep wording implementation-agnostic where possible so docs stay correct across runtime environments.

## Core terms

- **Entry**: runtime/pipeline item used during processing; not necessarily persisted.
- **Record**: persisted entity object stored by a persistence backend.
- **Session**: one chat session in memory (messages, model, token usage, timestamps).
- **SessionRecord**: one stored session record.
- **SessionState**: sessions aggregate (`sessions[]`, `activeSessionId`).
- **SessionStore**: read/write/create interface for session persistence.
- **Task**: lifecycle work request flowing through accept/queue/run/terminal states.
- **Task Queue**: runtime queue policy/mechanism that orders accepted tasks and enforces capacity/cancellation boundaries.
- **Mode**: explicit operating behavior profile for a request (`plan`, `work`, `verify`).
- **Provider**: model backend selected by the active model for a request (`openai`, `anthropic`, `gemini`, or `openai-compatible`), not “all configured providers”.
- **Guard**: pre-tool execution rule that may block calls.
- **Evaluator**: post-generation rule that accepts or requests regeneration.
- **Toolkit**: grouped domain tools exposed through adapters/composition.
- **Registry**: composition layer that wires implementations into an agent-facing surface under contracts (for example, tool registry, memory registry).
- **Lifecycle Policy**: bounded execution controls for lifecycle behavior (for example, timeouts and regeneration caps).
- **Memory Engine**: top-level memory capability that maintains continuity across turns.
- **Memory Pipeline**: internal staged flow inside the Memory Engine (ingest -> normalize -> select -> inject -> commit).
- **Memory Source**: pluggable provider that contributes memory entries and optional commit behavior (`stored`, `distill`).
- **Memory Source Strategy**: configured source ID set and order used by the Memory Engine (`memorySources`).
- **Distill**: automatic memory source that extracts and consolidates session knowledge into records.
- **Observation**: distill record tier capturing round-level facts.
- **Reflection**: distill record tier consolidating cross-round facts.
- **Continuation State**: persisted “Current task” and “Next step” cues carried into later turns.
