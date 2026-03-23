# Glossary

Naming conventions and core terms used across Acolyte code and docs.

## Naming conventions

| Suffix | Example | Meaning |
|---|---|---|
| Domain noun | `Session`, `Task` | In-memory domain entity used by core logic |
| `*Record` | `SessionRecord`, `TaskRecord` | One persisted entity record |
| `*Entry` | `MemoryContextEntry`, queue entry | One runtime/pipeline item (non-persisted by default) |
| `*State` | `SessionState` | Aggregate runtime/persisted state container |
| `*Contract` | `TaskContract`, `StatusContract` | Boundary shape for protocol/config/transport |
| `*Store` | `SessionStore`, `TaskStore` | Behavior interface for persistence operations |
| `*Schema` | `sessionSchema`, `taskSchema` | Zod runtime validator and source of truth for unions |
| `*Input` | `PhasePrepareInput`, `LifecycleInput` | Operation-specific input payload |
| `*Output` | `CliOutput` | Operation-specific output payload |

## Core terms

| Term | Definition |
|---|---|
| Base Agent Input | Immutable prompt input created during `prepare` and used as the base for each generation attempt |
| Context Budgeting | Proactive token allocation via tiktoken — system prompt reserved first, remaining space filled by priority (memory → attachments → history → tool payloads) |
| Continuation State | Persisted "Current task" and "Next step" cues carried into later turns |
| Distill | Automatic memory source family that extracts and consolidates knowledge into records (project/user/session scope variants) |
| Embedding | Provider-generated vector representation of a distill record, stored as a BLOB in SQLite and used for semantic recall |
| Entry | Runtime/pipeline item used during processing; not necessarily persisted |
| Evaluator | Post-generation rule that accepts or requests regeneration |
| Guard | Pre-tool execution rule that may block calls (step budget, file churn, duplicate call, redundant search/find/verify) |
| Host | The runtime environment around the model that provides tools, lifecycle structure, memory, guards, and recovery behavior |
| Lifecycle Feedback | Task-scoped runtime feedback emitted by evaluators or selected guard outcomes and consumed by the next matching lifecycle attempt |
| Lifecycle Policy | Bounded execution controls for lifecycle behavior (timeouts, regeneration caps) |
| Lifecycle Signal | Small model-to-host control signal emitted at generation completion (`done`, `no_op`, `blocked`) and accepted only if current runtime state does not contradict it |
| Lifecycle State | Internal task-scoped lifecycle runtime state used to carry feedback, verify outcomes, and repeated-failure streaks between attempts |
| Memory Engine | Top-level memory capability that maintains continuity across turns |
| Memory Pipeline | Internal staged flow inside the Memory Engine (ingest → normalize → select → inject → commit) |
| Memory Policy | Bounded operational thresholds for memory behavior (reflection retry limit, context message window, malformed tag warning threshold) |
| Memory Source | Pluggable provider that contributes memory entries and optional commit behavior (`stored`, `distill_project`, `distill_user`, `distill_session`) |
| Memory Source Strategy | Configured source ID set and order used by the Memory Engine (`memorySources`) |
| Message Kind | Semantic message classification for history behavior (`text`, `tool_payload`) |
| Mode | Explicit operating behavior profile for a request (`work`, `verify`) |
| Model Judgment | The model's responsibility for deciding how to complete the task; lifecycle policy supports this judgment but does not replace it with host-side task heuristics |
| Observation | Distill record tier capturing round-level facts |
| Provider | Model backend selected by the active model for a request (`openai`, `anthropic`, `gemini`, or `openai-compatible`) |
| Record | Persisted entity object stored by a persistence backend |
| Reflection | Distill record tier consolidating cross-round facts |
| Registry | Composition layer that wires implementations into an agent-facing surface under contracts (tool registry, memory registry) |
| Resource ID | Typed cross-session identity key used by memory and execution scoping (`proj_*`, `user_*`, `run_*`, `skill_*`) |
| Semantic Recall | Relevance-ranked memory selection using provider embeddings and cosine similarity, replacing recency-based ordering when a query is available |
| Session | One chat session in memory (messages, model, token usage, timestamps) |
| SessionRecord | One stored session record |
| SessionState | Sessions aggregate (`sessions[]`, `activeSessionId`) |
| SessionStore | Read/write/create interface for session persistence |
| Skill | Declarative prompt extension defined in a SKILL.md file with frontmatter metadata, tool restrictions, and compatibility checks |
| Step Budget | Guard that enforces per-cycle and total limits on tool calls to prevent runaway loops |
| Task | Lifecycle work request flowing through accept/queue/run/terminal states |
| Task Queue | Runtime queue policy that orders accepted tasks and enforces capacity/cancellation boundaries |
| Tool Cache | Two-tier cache for read-only and search tool results. L1 is in-memory LRU per task; L2 is SQLite-backed persistence across tasks within a session |
| Tool Recovery | Structured recovery payload attached to a tool failure when the tool knows the corrective action |
| Toolkit | Grouped domain tools exposed through adapters/composition |
| Verify Cycle | Post-write verification sequence; the evaluator transitions to verify mode, performs scoped verification, and re-generates on failure |
| Workspace Command | Typed shell command descriptor (`{ bin, args }`) used for lint, format, and verify commands |
| Workspace Profile | Cached per-workspace detection result containing ecosystem, package manager, lint/format/verify commands, and line width |
| Ecosystem Detector | Pluggable workspace detection rule that identifies project type and resolves available tooling |
