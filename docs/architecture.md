# Architecture

System map of Acolyte's runtime flow, module boundaries, and extension points.

## First-class concepts

Every concept below is modeled as an explicit entity with typed contracts, its own module, and clear boundaries — not buried as implementation details.

- **Sessions** — persistent conversation context with history and state
- **Tasks** — state-machined units of work with stable IDs and per-task scoping
- **Lifecycle phases** — resolve, prepare, generate, settle, finalize as separate modules
- **Effects** — lifecycle-owned side effects that run during the settle phase
- **Tools** — typed definitions with categories, schemas, and output contracts
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
lifecycle → budget → cache → toolkit → registry
```

- **budget:** step-budget check inlined into tool execution
- **cache:** per-task reuse layer for read-only and search tool results
- **toolkit:** domain tool definitions (`file-toolkit`, `code-toolkit`, `git-toolkit`, `shell-toolkit`, `web-toolkit`, `checklist-toolkit`)
- **registry:** toolkit registration and agent-facing tool surface
- **details:** see [Tooling](./tooling.md)

## Lifecycle flow

```text
resolve → prepare → generate → settle → finalize
```

- **resolve:** pick model and policy (sync, not a full phase)
- **prepare:** build inputs, context, and tools
- **generate:** run model + tool calls (one pass, no regeneration)
- **settle:** accept valid lifecycle signal, run format/lint effects
- **finalize:** persist outputs and emit final response

- **model-host protocol:** model may explicitly signal `done`/`no_op`/`blocked`; host validates against runtime state
- **host/model boundary:** host provides runtime structure; model decides how to complete the task
- **scheduling:** yield checks happen between lifecycle decisions, never mid-step
- **details:** see [Lifecycle](./lifecycle.md)

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

- **error handling:** tools emit failures/error codes; lifecycle surfaces them for the model to decide
- **step budget:** inlined into tool execution; blocks calls when budget is exhausted
- **protocol:** transport contract is transport-agnostic; see `docs/protocol.md`

## Observability and state

- **observability:** lifecycle emits ordered debug events per request (calls, tool results, effect decisions, summaries, errors). Events are dual-written to logfmt (`~/.acolyte/daemons/server.log`) and SQLite (`~/.acolyte/trace.db`); the CLI queries SQLite for indexed trace lookups
- **runtime config:** loaded from user/project config
- **state ownership:** chat/session state and memory are persisted outside lifecycle and passed in as inputs
- **task trace:** RPC emits task-state transitions with stable `task_id`:
```text
accepted → queued → running → completed|failed|cancelled
```

## Further reading

[Know the Ground](https://crisu.me/blog/know-the-ground) — Why the host should detect formatters, linters, and test runners from config files.
