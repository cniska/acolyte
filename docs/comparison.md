# Comparison

Compare Acolyte with the same eight current open-source terminal coding agents used in [Benchmarks](./benchmarks.md): [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/openai/codex), [Goose](https://github.com/aaif-goose/goose), [Open Interpreter](https://github.com/openinterpreter/openinterpreter), [Reasonix](https://github.com/esengine/DeepSeek-Reasonix), [Kimchi](https://github.com/getkimchi/kimchi), [Qwen Code](https://github.com/QwenLM/qwen-code), and [Grok Build](https://github.com/xai-org/grok-build).

See [Why Acolyte](./why-acolyte.md) for a summary.

The overview covers documented, shipped capabilities. “Partial” means the capability is optional, experimental, or narrower in scope. An em dash means the capability was not documented in the reviewed source; it does not prove absence.

## Feature overview

| Capability | Acolyte | OpenCode | Codex | Goose | Open Interpreter | Reasonix | Kimchi | Qwen Code | Grok Build |
|---|---|---|---|---|---|---|---|---|---|
| Multi-provider | ✓ | ✓ | partial | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Client/server or editor protocol | ✓ | ✓ | partial | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Workspace boundary or sandbox | ✓ | partial | ✓ | partial | ✓ | ✓ | partial | ✓ | ✓ |
| Agent skills | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Workspace controls are not equivalent security models. The row groups path boundaries, operating-system sandboxes, permission gates, and editor protocols so their presence can be compared without claiming identical isolation. A dash means the reviewed source did not establish the capability.

## Architecture

| Project | Architecture | Deployment model |
|---|---|---|
| **Acolyte** | Headless daemon + typed RPC clients | persistent local daemon |
| OpenCode | HTTP/WebSocket server + TUI, web, and desktop clients | client/server |
| Codex | Rust CLI, SDKs, app-server, and app-server daemon | CLI + optional server |
| Goose | ACP agent server with TUI, desktop, and editor clients | CLI + client/server |
| Open Interpreter | Rust terminal agent with ACP and Codex-compatible protocols | CLI + ACP |
| Reasonix | Go CLI with desktop client, plugins, and ACP integration | local CLI + desktop |
| Kimchi | TypeScript CLI with subagents, ACP, LSP, and remote sessions | CLI + remote sessions |
| Qwen Code | CLI with daemon SDK/UI and IDE integrations | CLI + client/server |
| Grok Build | Rust terminal harness and TUI with ACP and sandboxing | local CLI + ACP |

Acolyte runs as a headless daemon. The CLI and third-party clients connect over the same typed RPC protocol. Editor integrations can use that protocol without embedding a separate agent runtime.

Every chat request becomes a task with a state machine (`accepted → queued → running → completed | failed | cancelled`). Tasks have stable IDs and explicit state transitions while retained by the in-memory task store. Sessions, rather than tasks, provide continuity across requests. The RPC protocol exposes task transitions so clients can show real-time progress.

The TUI is a custom React terminal renderer built on `react-reconciler`.

## Lifecycle pipeline

Every Acolyte request flows through four phases, each implemented as its own module with its own tests:

```
resolve → prepare → generate → finalize
```

- **resolve**: pick model and policy
- **prepare**: wire tools and session context
- **generate**: run the model with tool calls; effects apply per tool result
- **finalize**: accept the terminal step, persist results, and emit the response

The lifecycle trusts the model to make good decisions. Format and lint effects run automatically after writes, and lint errors surface in the tool result for the model to decide on. A step budget inlined into tool execution enforces one per-turn tool-call limit to prevent runaway loops.

The distinction is not that other agents lack a loop. Acolyte makes its lifecycle phases, native completion, and post-tool effects explicit contracts with independent tests. The benchmark and comparison do not claim that this architecture produces better model outcomes by itself.

## Workspace detection

Acolyte auto-detects project tooling from workspace config files at lifecycle start. The detected profile includes ecosystem, package manager, lint command, format command, and test command. Detection is cached per workspace and feeds into the lifecycle policy and agent instructions.

The other projects expose different project-context and command-discovery mechanisms, so the comparison is not a binary capability test.

## Workspace sandboxing

Acolyte enforces a workspace sandbox that prevents tool operations outside the resolved workspace root. All file paths are validated against the sandbox boundary using `realpath`-based resolution before any read, write, or delete operation.

Codex provides operating-system sandbox policies with writable-directory restrictions. Qwen Code supports container sandboxes. Reasonix documents workspace permissions and sandbox controls, while Open Interpreter documents native sandboxing. These approaches cover different threats and should not be read as equivalent to Acolyte's path boundary.

## Observability

Each Acolyte request emits ordered, task-scoped events for task state, workspace resolution, lifecycle phases, tool calls and results, cache decisions, budget blocks, effects, memory commits, and its final summary.

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

OpenCode, Codex, Goose, Open Interpreter, Reasonix, Kimchi, Qwen Code, and Grok Build also document skills or equivalent skill/plugin extensions. The extension models differ: some treat skills as prompt resources, while others also expose executable plugins or MCP servers.

Core systems expose minimal, well-defined extension points: lifecycle policies, tool registration, memory strategies, skill metadata, and configuration layers. The surface is intentionally narrow; Acolyte is an opinionated product, not a general-purpose agent framework.

## Memory

How each agent retains knowledge across sessions.

Acolyte stores memory in three scopes: session, project, and user. Memory is recalled on demand rather than injected into every prompt. A post-generation distiller can extract observations automatically, while explicit tools let the agent search, add, and remove entries. Retrieval combines semantic similarity with token overlap.

The other projects use different combinations of session persistence, project files, repository maps, compaction, plans, and memory extensions. These mechanisms solve different context problems and are not direct substitutes for Acolyte's scoped memory.

## Context budgeting

How each agent manages the token window when context grows large.

Acolyte budgets context **before assembly** and maintains a bounded running context window. It reserves known prompt costs, keeps recent conversation within the remaining budget, and caps tool results individually. When earlier conversation falls outside the window, the model receives an explicit gap notice and can retrieve it with `session-search`. Durable session, project, and user context remains available through on-demand `memory-search`, not upfront prompt injection.

The other projects use different approaches to compaction, repository-map context, planning, and session persistence. Acolyte keeps its live window bounded and retrieves earlier or durable context on demand rather than compacting the conversation into a replacement summary. Each completed request also reports input, output, total, and prompt-breakdown token counts. See [Context Budgeting](./context-budgeting.md) for the runtime behavior.

## Code quality

See [Benchmarks](./benchmarks.md) for the measured source comparison. At the recorded snapshot, Acolyte has the smallest measured source set, smallest average module size, fewest runtime dependencies, and highest measured TypeScript validation-call density in the selected peer set.

These are static engineering signals. They do not establish task success, model quality, security equivalence, or overall product superiority.

Reviewed against the revisions recorded in [Benchmarks](./benchmarks.md).

Updated 20 July 2026.
