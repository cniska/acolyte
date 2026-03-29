# Architecture

System map of Acolyte's runtime flow, module boundaries, and extension points.

## First-class concepts

Every concept below is modeled as an explicit entity with typed contracts, its own module, and clear boundaries — not buried as implementation details.

- **Sessions** — persistent conversation context with history and state
- **Tasks** — state-machined units of work with stable IDs and per-task scoping
- **Lifecycle phases** — resolve, prepare, generate, evaluate, finalize as separate modules
- **Lifecycle state** — task-scoped internal retry/support state owned by the lifecycle
- **Effects** — lifecycle-owned side effects that run between generation and pure evaluation
- **Modes** — explicit operating behaviors (work, verify) with per-mode model routing
- **Tools** — typed definitions with categories, permissions, schemas, and output contracts
- **Guards** — behavioral checks that run before every tool call
- **Evaluators** — post-generation inspectors that decide accept or re-generate
- **Skills** — declarative prompt extensions with metadata and tool restrictions
- **Memory sources** — pluggable memory tiers (session, project, user) with pipeline stages
- **Protocol** — typed RPC messages with request correlation and lifecycle envelopes

## System flow

```text
CLI → client → server → lifecycle → model + tools
```

- **execution model:** one active task per session, with ordered queued tasks
- **yielding:** lifecycle only yields at safe checkpoints (never mid-step)

## TUI

```text
React tree → reconciler → TUI DOM → serialize → terminal output
```

- custom React reconciler for terminal rendering
- **details:** see [TUI](./tui.md)

## Daemon flow

```text
client → rpc server → task queue → lifecycle worker
```

- **rpc server:** accepts requests, exposes task/status streams, and routes to queue/lifecycle
- **task queue:** enforces ordering, capacity, and cancellation boundaries
- **lifecycle worker:** executes accepted tasks through lifecycle phases

## Task flow

```text
accept → queue → run → complete|fail|cancel
```

- **accept:** validate request and assign `task_id`
- **queue:** hold until runnable under queue policy
- **run:** execute lifecycle for active task
- **complete|fail|cancel:** emit terminal state and persist task outcome
- **details:** see [Sessions and tasks](./sessions-tasks.md)

## Tool layering

```text
lifecycle → guard → cache → toolkit → registry
```

- **guard:** pre-execution safety/redundancy checks and post-execution call recording
- **cache:** per-task reuse layer for read-only and search tool results
- **toolkit:** domain tool definitions with guarded execution (`file-toolkit`, `code-toolkit`, `git-toolkit`, `shell-toolkit`, `web-toolkit`, `checklist-toolkit`)
- **registry:** toolkit registration, permission filtering, and agent-facing tool surface
- **details:** see [Tooling](./tooling.md)

## Lifecycle flow

```text
resolve → prepare → generate → evaluate → finalize
```

- **resolve:** pick mode and model (sync, not a full phase)
- **prepare:** build inputs, context, and tools
- **generate:** run model + tool calls
- **evaluate:** accept valid signals, run effects, then apply pure evaluators to decide accept/retry/regenerate (bounded)
- **mode applicability:** guards, effects, and evaluators declare their applicable modes; orchestrators enforce those boundaries centrally
- **completion signaling:** generation may emit `done`/`no_op`/`blocked`; evaluate accepts valid signals
- **finalize:** persist outputs and emit final response

- **regeneration:** effects and evaluators may request regeneration, bounded by caps
- **lifecycle state:** internal task-scoped retry/support state; never persisted to session or memory
- **model-host protocol:** model may explicitly signal `done`/`no_op`/`blocked`; host validates against runtime state
- **host/model boundary:** host provides runtime structure and feedback; model decides how to complete the task
- **scheduling:** yield checks happen between lifecycle decisions, never mid-step
- **task metrics:** evaluator and summary metrics are scoped by `task_id`
- **details:** see [Lifecycle](./lifecycle.md)

## Modes

- explicit operating behaviors are modeled as `work` and `verify`
- **details:** see [Modes](./modes.md)

## Memory engine

```text
Memory Engine
  → Memory Pipeline (ingest → normalize → select → inject → commit)
  → Memory context in system prompt
```

- Memory Engine composes source strategy, pipeline stages, and distill behavior to provide continuity across turns
- **source strategy:** configured source IDs and order (`memorySources`) determine source composition
- **pipeline seams:** normalization and selection are strategy-injectable behind registry contracts
- **selection default:** one continuation cue is kept; selection prefers the freshest continuation that fits budget
- **integration:** memory context is injected during request setup; commit is best-effort background work at finalize
- **details:** see [Memory](./memory.md)

## Dependency injection

- **No container, no decorators** — dependencies are passed as typed parameters with defaults from `appConfig`.
- **Deps vs input** — factory functions that need both configuration and runtime data take two arguments: a `*Deps` object for config that is fixed for the process lifetime, and an `*Input` object for per-request runtime data (e.g. `createFileToolkit(deps: ToolkitDeps, input: ToolkitInput)`).
- **Defaults at the edge** — library modules accept injected params; composition roots (`cli-command-registry`, `server-chat-runtime`, `cli-chat`) read `appConfig` and pass values down.
- **Tests inject directly** — tests pass config through the new params instead of mutating `appConfig`.

## Contracts

- **error handling:** tools emit failures/error codes; lifecycle owns retry/regeneration policy
- **guarding:** guards run before tool execution, can block calls, and are reported through lifecycle events
- **protocol:** transport contract is transport-agnostic; see `docs/protocol.md`

## Observability and state

- **observability:** lifecycle emits ordered debug events per request (calls, tool results, effect/evaluator decisions, summaries, errors). Events are dual-written to logfmt (`~/.acolyte/daemons/server.log`) and SQLite (`~/.acolyte/trace.db`); the CLI queries SQLite for indexed trace lookups
- **runtime config:** loaded from user/project config
- **state ownership:** chat/session state and memory are persisted outside lifecycle and passed in as inputs
- **task trace:** RPC emits task-state transitions with stable `task_id`:
```text
accepted → queued → running → completed|failed|cancelled
```

## Further reading

[Know the Ground](https://crisu.me/blog/know-the-ground) — Why the host should detect formatters, linters, and test runners from config files.
