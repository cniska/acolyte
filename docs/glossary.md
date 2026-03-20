# Glossary

Naming conventions and core terms used across Acolyte code and docs.

## Naming conventions

- **Domain noun** (`Session`, `Task`): in-memory domain entity used by core logic.
- **`*Record`** (`SessionRecord`, `TaskRecord`): one persisted entity record.
- **`*Entry`** (`MemoryContextEntry`, queue entry): one runtime/pipeline item (non-persisted by default).
- **`*State`** (`SessionState`): aggregate runtime/persisted state container.
- **`*Contract`** (`TaskContract`, `StatusContract`): boundary shape for protocol/config/transport.
- **`*Store`** (`SessionStore`, `TaskStore`): behavior interface for persistence operations.
- **`*Schema`** (`sessionSchema`, `taskSchema`): Zod runtime validator and source of truth for unions.
- **`*Input` / `*Output`**: operation-specific payload types.

## Core terms

- **Context Budgeting**: proactive token allocation via tiktoken — system prompt reserved first, remaining space filled by priority (memory → attachments → history → tool payloads).
- **Continuation State**: persisted “Current task” and “Next step” cues carried into later turns.
- **Distill**: automatic memory source family that extracts and consolidates knowledge into records (project/user/session scope variants).
- **Entry**: runtime/pipeline item used during processing; not necessarily persisted.
- **Evaluator**: post-generation rule that accepts or requests regeneration.
- **Guard**: pre-tool execution rule that may block calls (step budget, file churn, duplicate call, redundant search/find/verify).
- **Host**: the runtime environment around the model that provides tools, lifecycle structure, memory, guards, and recovery behavior.
- **Lifecycle Policy**: bounded execution controls for lifecycle behavior (for example, timeouts and regeneration caps).
- **Lifecycle Feedback**: task-scoped runtime feedback emitted by evaluators or selected guard outcomes and consumed by the next matching lifecycle attempt.
- **Lifecycle Signal**: small model-to-host control signal emitted at generation completion (`done`, `no_op`, `blocked`) and accepted only if current runtime state does not contradict it.
- **Lifecycle State**: internal task-scoped lifecycle runtime state used to carry feedback, verify outcomes, and repeated-failure streaks between attempts.
- **Model Judgment**: the model’s responsibility for deciding how to complete the task; lifecycle policy supports this judgment but does not replace it with host-side task heuristics.
- **Embedding**: provider-generated vector representation of a distill record, stored as a BLOB in SQLite and used for semantic recall.
- **Memory Engine**: top-level memory capability that maintains continuity across turns.
- **Memory Pipeline**: internal staged flow inside the Memory Engine (ingest → normalize → select → inject → commit).
- **Memory Policy**: bounded operational thresholds for memory behavior (reflection retry limit, context message window, malformed tag warning threshold).
- **Memory Source**: pluggable provider that contributes memory entries and optional commit behavior (`stored`, `distill_project`, `distill_user`, `distill_session`).
- **Memory Source Strategy**: configured source ID set and order used by the Memory Engine (`memorySources`).
- **Message Kind**: semantic message classification for history behavior (`text`, `tool_payload`).
- **Mode**: explicit operating behavior profile for a request (`work`, `verify`).
- **Observation**: distill record tier capturing round-level facts.
- **Provider**: model backend selected by the active model for a request (`openai`, `anthropic`, `gemini`, or `openai-compatible`), not “all configured providers”.
- **Base Agent Input**: immutable prompt input created during `prepare` and used as the base for each generation attempt.
- **Record**: persisted entity object stored by a persistence backend.
- **Reflection**: distill record tier consolidating cross-round facts.
- **Semantic Recall**: relevance-ranked memory selection using provider embeddings and cosine similarity, replacing recency-based ordering when a query is available.
- **Registry**: composition layer that wires implementations into an agent-facing surface under contracts (for example, tool registry, memory registry).
- **Resource ID**: typed cross-session identity key used by memory and execution scoping (`proj_*` for project, `user_*` for user, `run_*` for run, `skill_*` for skill).
- **Session**: one chat session in memory (messages, model, token usage, timestamps).
- **SessionRecord**: one stored session record.
- **SessionState**: sessions aggregate (`sessions[]`, `activeSessionId`).
- **SessionStore**: read/write/create interface for session persistence.
- **Skill**: declarative prompt extension defined in a SKILL.md file with frontmatter metadata, tool restrictions, and compatibility checks. Invoked via slash commands.
- **Step Budget**: guard that enforces per-cycle and total limits on tool calls to prevent runaway loops.
- **Task**: lifecycle work request flowing through accept/queue/run/terminal states.
- **Task Queue**: runtime queue policy/mechanism that orders accepted tasks and enforces capacity/cancellation boundaries.
- **Tool Cache**: two-tier cache for read-only and search tool results. L1 is an in-memory LRU per task; L2 is SQLite-backed persistence across tasks within a session. Invalidated on writes; shell commands clear both tiers.
- **Tool Recovery**: structured recovery payload attached to a tool failure when the tool knows the corrective action. Carries `tool`, `kind`, `summary`, and `instruction`, and may include next-step hints like `nextTool` or `targetPaths`, so lifecycle can regenerate with targeted recovery guidance instead of host-side string matching.
- **Toolkit**: grouped domain tools exposed through adapters/composition.
- **Verify Cycle**: post-write verification sequence that runs when verification is enabled for the request scope; the evaluator transitions to verify mode, performs the lightest sufficient scoped verification or review, and re-generates on failure.
