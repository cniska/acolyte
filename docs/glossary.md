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
| Base Agent Input | Immutable prompt input created during `prepare` and used for the generation pass |
| ChatRow | One display block in the chat transcript; may render as many visual lines (e.g. a usage summary or status panel) |
| Checklist | Inline progress display for multi-step tasks, defined by `checklist-create` and updated by `checklist-update` |
| Context Budgeting | Token allocation strategy that reserves system space first and fills the remaining budget by priority |
| Directive | Model-to-host structured annotation emitted via `@` prefix (e.g. `@signal done`, `@observe project`) |
| Distill | Memory source that extracts observations from conversations at project, user, or session scope |
| Embedding | Provider-generated vector representation of a memory record used for semantic recall |
| Ecosystem Detector | Pluggable rule that identifies the workspace type and resolves available tooling |
| Entry | Runtime or pipeline item used during processing and not necessarily persisted |
| Effect | Lifecycle-owned side-effect applied per-tool-result via callback (format, lint) |
| Host | Runtime environment around the model that provides tools, lifecycle structure, memory, and recovery |
| Lifecycle Policy | Centralized limits and defaults for lifecycle behavior |
| Lifecycle Signal | Model-to-host control signal emitted at generation completion (`done`, `no_op`, `blocked`) |
| Lifecycle State | Internal task-scoped runtime state used during the lifecycle pass |
| Memory Engine | Top-level memory capability that maintains continuity across turns |
| Memory Pipeline | Internal memory flow from ingest through commit |
| Memory Policy | Centralized limits and defaults for memory behavior |
| Memory Distiller | Extracts and commits observations from conversations after each request |
| Memory Toolkit | On-demand tools (`memory-search`, `memory-add`, `memory-remove`) the model invokes to access memory at runtime |
| Message Kind | Semantic message classification used by history handling (`text`, `tool_payload`) |
| Model Judgment | The model's responsibility for deciding how to complete the task within host constraints |
| Observation | Memory record kind for facts extracted from conversations via `@observe` directives |
| Policy | Centralized subsystem rules, limits, or defaults that make intended behavior explicit without owning the implementation |
| Provider | Model backend selected for a request (`openai`, `anthropic`, `gemini`, or `openai-compatible`) |
| Record | Persisted entity object stored by a persistence backend |
| Registry | Composition layer that wires implementations into an agent-facing surface under shared contracts |
| Resource ID | Typed cross-session identity key used for memory and execution scoping |
| Semantic Recall | Relevance-ranked memory selection using embeddings and cosine similarity |
| Session | One chat session in memory, including messages, model, token usage, and timestamps |
| SessionRecord | One stored session record |
| SessionState | Aggregate session state (`sessions[]`, `activeSessionId`) |
| SessionStore | Read/write/create interface for session persistence |
| Skill | Declarative prompt extension defined in a `SKILL.md` file with metadata and compatibility constraints |
| Step Budget | Per-cycle and total tool-call limit inlined into tool execution to prevent runaway loops |
| Task | Lifecycle work request moving through accept, queue, run, and terminal states |
| Task Queue | Runtime queue policy that orders accepted tasks and enforces capacity and cancellation boundaries |
| Tool Cache | Two-tier cache for read-only and search tool results across a task and session |
| Tool Recovery | Structured recovery payload attached to a tool failure when the tool knows the corrective action |
| Toolkit | Group of domain tools exposed through adapters and composition |
| Workspace Command | Typed shell command descriptor used for lint, format, and test commands |
| Workspace Profile | Cached per-workspace detection result containing ecosystem, package manager, and commands |
