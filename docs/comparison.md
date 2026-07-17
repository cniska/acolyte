# Comparison

Compare Acolyte with eight open-source terminal coding agents across architecture, lifecycle behavior, tooling, observability, and extensibility.

See [Why Acolyte](./why-acolyte.md) for a summary.

Projects compared: [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/openai/codex), [Crush](https://github.com/charmbracelet/crush), [Aider](https://github.com/Aider-AI/aider), [Goose](https://github.com/block/goose), [Qwen Code](https://github.com/QwenLM/qwen-code), [Plandex](https://github.com/plandex-ai/plandex), [Mistral Vibe](https://github.com/mistralai/mistral-vibe).

The overview covers documented, shipped capabilities. “Partial” means the capability is optional, experimental, or narrower in scope. An em dash means the capability was not documented in the reviewed source; it does not prove absence.

## Feature overview

| Capability | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Multi-provider | ✓ | ✓ | partial | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Client/server mode | ✓ | ✓ | partial | ✓ | — | ✓ | ✓ | ✓ | partial |
| Workspace boundary or sandbox | ✓ | partial | ✓ | partial | — | partial | ✓ | ✓ | partial |
| Agent Skills (`SKILL.md`) | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | ✓ |

Workspace controls are not equivalent security models. The row groups path boundaries, operating-system sandboxes, and permission gates so their presence can be compared without claiming identical isolation.

## Architecture

| Project | Architecture | Deployment model |
|---|---|---|
| **Acolyte** | Headless daemon + typed RPC clients | persistent local daemon |
| OpenCode | HTTP/WebSocket server + TUI, web, and desktop clients | client/server |
| Codex | Rust CLI, SDKs, app-server, and experimental app-server daemon | CLI + optional server |
| Crush | Go CLI with Bubble Tea TUI and shared workspace server | CLI + client/server |
| Aider | Python CLI | single process |
| Goose | ACP agent server with TUI, desktop, and editor clients | CLI + client/server |
| Qwen Code | CLI with daemon SDK/UI and IDE integrations | CLI + client/server |
| Plandex | CLI with self-hostable or cloud server | client/server |
| Mistral Vibe | Python CLI with ACP integration | CLI + ACP |

Acolyte runs as a headless daemon. The CLI and third-party clients connect over the same typed RPC protocol. Editor integrations can use that protocol without embedding a separate agent runtime.

Every chat request becomes a task with a state machine (`accepted → queued → running → completed | failed | cancelled`). Tasks have stable IDs and explicit state transitions while retained by the in-memory task store. Sessions, rather than tasks, provide continuity across requests. The RPC protocol exposes task transitions so clients can show real-time progress.

The TUI is a custom React terminal renderer built on `react-reconciler`.

## Lifecycle pipeline

Every request flows through four phases, each implemented as its own module with its own tests:

```
resolve → prepare → generate → finalize
```

- **resolve**: pick model and policy
- **prepare**: wire tools and session context
- **generate**: run the model with tool calls, effects apply per-tool-result
- **finalize**: accept lifecycle signal, persist results, emit the response

The lifecycle trusts the model to make good decisions. Format and lint effects run automatically after writes, and lint errors surface in the tool result for the model to decide on. A step budget inlined into tool execution enforces per-turn and total tool-call limits to prevent runaway loops.

The distinction is not that other agents lack a loop. Acolyte makes its lifecycle phases, completion signals, and post-tool effects explicit contracts with independent tests.

## Workspace detection

Acolyte auto-detects project tooling from workspace config files at lifecycle start. The detected profile includes ecosystem, package manager, lint command, format command, and test command. Detection is cached per workspace and feeds into the lifecycle policy and agent instructions.

Aider supports user-configured per-language lint commands through `--lint-cmd`. Other projects expose different project-context and command-discovery mechanisms, so the comparison is not a binary capability test.

## Workspace sandboxing

Acolyte enforces a workspace sandbox that prevents tool operations outside the resolved workspace root. All file paths are validated against the sandbox boundary using `realpath`-based resolution before any read, write, or delete operation.

Codex provides operating-system sandbox policies with writable-directory restrictions. Qwen Code supports container sandboxes. Plandex stages changes in a cumulative diff sandbox, while several other projects use approval or trust gates. These approaches cover different threats and should not be read as equivalent to Acolyte's path boundary.

## Observability

Each request emits ordered, task-scoped events for task state, workspace resolution, lifecycle phases, tool calls and results, cache decisions, budget blocks, effects, memory commits, and its final summary.

Events are written locally to logfmt and SQLite. The `acolyte trace` command queries SQLite to list recent tasks or render one task's compact tool timeline and summary:

```
timestamp=... task_id=task_abc123 event=lifecycle.tool.call tool=file-edit path=src/foo.ts
timestamp=... task_id=task_abc123 event=lifecycle.tool.result tool=file-edit duration_ms=45 is_error=false
timestamp=... task_id=task_abc123 event=lifecycle.eval.decision effect=lint action=done
timestamp=... task_id=task_abc123 event=lifecycle.summary model_calls=1 read=3 search=1 write=1
```

`acolyte trace task <id> --verbose` includes tool output and cache events; `--json` returns raw event lines. The trace stays local and queryable by task ID, and Acolyte does not include a product telemetry client. This is separate from provider telemetry and external tracing services. See [Observability](./observability.md) for the full event model.

## Skills and extensibility

Acolyte supports the [SKILL.md standard](https://agentskills.io) for declarative prompt extensions. Skills live in `.agents/skills/` and can be activated by the agent or through slash commands. Multiple skills can remain active in the same session.

OpenCode, Codex, Crush, Goose, Qwen Code, and Mistral Vibe also support Agent Skills. Goose loads skills through its Summon extension and continues to use MCP for executable extensions.

Core systems expose minimal, well-defined extension points: lifecycle policies, tool registration, memory strategies, skill metadata, and configuration layers. The surface is intentionally narrow; Acolyte is an opinionated product, not a general-purpose agent framework.

## Memory

How each agent retains knowledge across sessions.

Acolyte stores memory in three scopes: session, project, and user. Memory is recalled on demand rather than injected into every prompt. A post-generation distiller can extract observations automatically, while explicit tools let the agent search, add, and remove entries. Retrieval combines semantic similarity with token overlap.

Goose offers a memory extension, Aider combines repository maps with chat restore, and Plandex retains plan and conversation state. These mechanisms solve different context problems and are not direct substitutes for Acolyte's scoped memory.

## Context budgeting

How each agent manages the token window when context grows large.

Acolyte budgets context **before assembly** and maintains a bounded running context window. It reserves known prompt costs, keeps recent conversation within the remaining budget, and caps tool results individually. When earlier conversation falls outside the window, the model receives an explicit gap notice and can retrieve it with `session-search`. Durable session, project, and user context remains available through on-demand `memory-search`, not upfront prompt injection.

OpenCode and Mistral Vibe support compaction, Aider ranks repository-map context, and Plandex summarizes long-running conversations. Acolyte keeps its live window bounded and retrieves earlier or durable context on demand rather than compacting the conversation into a replacement summary. Each completed request also reports input, output, total, and prompt-breakdown token counts. See [Context Budgeting](./context-budgeting.md) for the runtime behavior.

## Code quality

See [Benchmarks](./benchmarks.md) for the measured source comparison. At the recorded snapshot, Acolyte has the lowest counted dependency total and smallest average module size. It also has the lowest measured `any` escape density among the TypeScript projects.

Reviewed against the revisions recorded in [Benchmarks](./benchmarks.md).

Updated 14 July 2026.
