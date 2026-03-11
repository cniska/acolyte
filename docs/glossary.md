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
- **Lifecycle Policy**: bounded execution controls for lifecycle behavior (for example, timeouts and regeneration caps).
- **Memory Engine**: top-level memory capability that maintains continuity across turns.
- **Memory Pipeline**: internal staged flow inside the Memory Engine (ingest → normalize → select → inject → commit).
- **Memory Source**: pluggable provider that contributes memory entries and optional commit behavior (`stored`, `distill_project`, `distill_user`, `distill_session`).
- **Memory Source Strategy**: configured source ID set and order used by the Memory Engine (`memorySources`).
- **Message Kind**: semantic message classification for history behavior (`text`, `tool_payload`).
- **Mode**: explicit operating behavior profile for a request (`work`, `verify`).
- **Observation**: distill record tier capturing round-level facts.
- **Provider**: model backend selected by the active model for a request (`openai`, `anthropic`, `gemini`, or `openai-compatible`), not “all configured providers”.
- **Record**: persisted entity object stored by a persistence backend.
- **Reflection**: distill record tier consolidating cross-round facts.
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
- **Tool Cache**: per-task LRU cache for read-only and search tool results. Invalidated on writes; shell commands clear the entire cache.
- **Toolkit**: grouped domain tools exposed through adapters/composition.
- **Verify Cycle**: automatic post-write sequence where the evaluator transitions to verify mode and runs project checks, re-generating on failure.
