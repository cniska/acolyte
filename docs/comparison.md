# Comparison

Compare Acolyte with eight current open-source terminal coding agents across architecture, lifecycle behavior, sandboxing, observability, memory, and extensibility.

See [Why Acolyte?](./why-acolyte.md) for a summary.

Projects compared: [Kimchi](https://github.com/getkimchi/kimchi), [Kode](https://github.com/shareAI-lab/Kode-CLI), [OpenCode](https://github.com/anomalyco/opencode), [Qwen Code](https://github.com/QwenLM/qwen-code), [Codex](https://github.com/openai/codex), [Goose](https://github.com/aaif-goose/goose), [Grok Build](https://github.com/xai-org/grok-build), and [Reasonix](https://github.com/esengine/DeepSeek-Reasonix).

The overview covers documented, shipped capabilities. “Partial” means the capability is optional, experimental, or narrower in scope; ✗ means no shipped equivalent.

## Feature overview

The rows follow the order of the sections below.

| Capability | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---|---|---|---|---|---|---|---|---|
| Multi-provider | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✓ | ✓ | ✓ |
| Client/server or editor protocol | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Format and lint after edits | ✓ | partial | partial | partial | partial | partial | partial | partial | partial |
| Project commands auto-detected | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Workspace boundary or sandbox | ✓ | partial | partial | partial | ✓ | ✓ | partial | ✓ | ✓ |
| Local per-request trace | ✓ | ✗ | ✗ | partial | partial | partial | partial | partial | partial |
| Agent skills | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cross-session memory | ✓ | ✗ | partial | ✗ | ✓ | partial | partial | partial | ✓ |
| Evicted turns retrievable | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ |

What the short labels mean: format and lint run as built-in effects with no hook to write; project commands are the test, lint, and format commands the host resolves from the workspace instead of the model reading them out of an instruction file; the trace is a local per-request event record queryable by task ID; cross-session memory is maintained by the agent rather than a file you edit; evicted turns are the ones that have left the context window. Every other project can run format and lint through a hook or plugin the user configures, but none enables it by default, and their traces are opt-in, exported to an external collector, or diagnostic bundles.

Workspace controls are not equivalent security models. The row groups path boundaries, operating-system sandboxes, permission gates, and editor protocols so their presence can be compared without claiming identical isolation.

## Architecture

| Project | Architecture | Deployment model |
|---|---|---|
| **Acolyte** | Headless daemon + typed RPC clients | persistent local daemon |
| Kimchi | Distribution of the third-party pi harness, extended with subagents, ACP, LSP, and remote sessions | CLI + remote sessions |
| Kode | TypeScript monorepo: CLI, ACP/HTTP server, MCP integration, and a published agent SDK | CLI + ACP + server |
| OpenCode | HTTP + SSE server + TUI, web, and desktop clients | client/server |
| Qwen Code | CLI with daemon SDK/UI and IDE integrations | CLI + client/server |
| Codex | Rust workspace (TUI, exec, core) with app-server, MCP server mode, and TypeScript/Python SDKs | CLI + desktop + optional server |
| Goose | ACP agent server with TUI, desktop, and editor clients | CLI + client/server |
| Grok Build | Rust terminal harness and TUI with ACP and sandboxing | CLI + ACP |
| Reasonix | Go CLI with desktop client, plugins, and ACP integration | CLI + desktop |

Kimchi is the only project here that does not own its agent runtime: it pins the pi packages with local patches and layers extensions and modes on them. A capability in its column can come from that substrate rather than from Kimchi.

Acolyte runs as a headless daemon. The CLI and third-party clients connect over the same typed RPC protocol. Editor integrations can use that protocol without embedding a separate agent runtime.

Every chat request becomes a task with a stable ID and explicit transitions in the in-memory task store:

```text
accepted → queued → running → completed | failed | cancelled
```

Sessions, rather than tasks, provide continuity across requests. The RPC protocol exposes task transitions so clients can show real-time progress.

The TUI is a custom React terminal renderer built on `react-reconciler`.

## Lifecycle pipeline

Every Acolyte request flows through four phases, each implemented as its own module with its own tests:

```
resolve → prepare → generate → finalize
```

- **resolve** — pick model and policy
- **prepare** — wire tools and session context
- **generate** — run the model with tool calls; effects apply per tool result
- **finalize** — accept the terminal step, persist results, and emit the response

The lifecycle trusts the model to make good decisions. Format and lint effects run automatically after writes, and lint errors surface in the tool result for the model to decide on. A step budget inlined into tool execution enforces one per-turn tool-call limit to prevent runaway loops.

The other projects reach the same outcome through hooks or plugins that the user configures and maintains: a post-tool hook in Kimchi, Kode, Qwen Code, Codex, Goose, Grok Build, and Reasonix, and a `tool.execute.after` plugin callback in OpenCode. None of them ships a format or lint effect enabled by default.

The distinction is not that other agents lack a loop. Acolyte makes its lifecycle phases, native completion, and post-tool effects explicit contracts with independent tests. The benchmark and comparison do not claim that this architecture produces better model outcomes by itself.

## Workspace detection

Acolyte auto-detects project tooling from workspace config files at lifecycle start. The detected profile includes ecosystem, package manager, lint command, format command, and test command. Detection is cached per workspace and feeds into the lifecycle policy and agent instructions.

The other projects carry project context in instruction files such as `AGENTS.md` and in user configuration; the model reads the commands from there rather than the host resolving them from the workspace.

## Workspace sandboxing

Acolyte enforces a workspace sandbox that prevents tool operations outside the resolved workspace root. All file paths are validated against the sandbox boundary using `realpath`-based resolution before any read, write, or delete operation.

Codex provides operating-system sandbox policies with writable-directory restrictions. Qwen Code supports container sandboxes and macOS Seatbelt profiles. Reasonix documents workspace permissions and sandbox controls. Kode has a file-tool permission engine and an OS shell sandbox, both opt-in: the default mode skips permission checks, and the sandbox engages only under `--safe`. These approaches cover different threats and should not be read as equivalent to Acolyte's path boundary.

## Observability

Each Acolyte request emits ordered, task-scoped events for task state, workspace resolution, lifecycle phases, tool calls and results, budget blocks, effects, memory commits, and its final summary.

Events are written locally to logfmt and SQLite. The `acolyte trace` command queries SQLite to list recent tasks or render one task's compact tool timeline and summary:

```
timestamp=... task_id=task_abc123 event=lifecycle.tool.call tool=file-edit path=src/foo.ts
timestamp=... task_id=task_abc123 event=lifecycle.tool.result tool=file-edit duration_ms=45 is_error=false
timestamp=... task_id=task_abc123 event=lifecycle.eval.decision effect=lint action=done
timestamp=... task_id=task_abc123 event=lifecycle.summary model_calls=1 read=3 search=1 write=1
```

`acolyte trace task <id> --verbose` includes tool output; `--json` returns raw event lines. The trace stays local and queryable by task ID, and Acolyte does not include a product telemetry client. This is separate from provider telemetry and external tracing services. See [Observability](./observability.md) for the full event model.

The other projects record less by default. Codex writes local rollout-trace bundles only when `CODEX_ROLLOUT_TRACE_ROOT` is set, and OpenCode writes a JSONL event trace only under `OPENCODE_DIRECT_TRACE`. Qwen Code and Goose emit OpenTelemetry spans to a collector the user configures, Grok Build uploads session traces with telemetry enabled, and Reasonix packages session diagnostics into a zip on request. Kimchi and Kode keep conversation logs but no event trace.

## Skills and extensibility

Acolyte supports the [SKILL.md standard](https://agentskills.io) for declarative prompt extensions and the [Agent Plugins standard](https://agent-plugins.org) for packaging skills and MCP servers together. Skills live in `.agents/skills/`, in the workspace for a project and in the home directory globally; users can activate them with slash commands or the picker, and the model activates and deactivates them as work changes. Active skills persist across turns, and multiple skills can remain active in one session.

All eight compared projects load `SKILL.md` skills natively rather than through an add-on. The extension models around them differ: some treat skills as prompt resources, while others also expose executable plugins or MCP servers.

Core systems expose minimal, well-defined extension points: lifecycle policies, tool registration, memory strategies, skill metadata, and configuration layers. The surface is intentionally narrow; Acolyte is an opinionated product, not a general-purpose agent framework.

## Memory

How each agent retains knowledge across sessions.

Acolyte stores memory in three scopes: session, project, and user. The agent recalls it on demand rather than receiving it in every prompt. It can search or add entries; users can also remove, list, and restore them from the CLI.

After each request, a background distiller derives durable, self-contained work facts from task activity and conversation. It skips duplicates and already-distilled messages, and can replace outdated facts with sharper successors. Replaced facts move to a restorable archive with lineage instead of being deleted.

Retrieval is scope-aware and uses semantic similarity, TF-IDF token overlap, and optional topic filtering. Embeddings use the selected provider by default or an explicitly configured OpenAI-compatible endpoint, independently of chat.

Memory is no longer rare in this set, but it is usually gated. Qwen Code ships automatic workspace memory with remember, forget, and consolidation tasks, and Reasonix ships an auto-memory store with host-side recall. Codex has a full memory-write pipeline that stays off unless the `memories` feature is enabled, Grok Build's markdown memory with consolidation passes requires `--experimental-memory`, and Goose ships memory as a built-in extension the user enables. Kode stores and recalls durable entries but only extracts statements the user marks explicitly, never inferring them from ordinary prose. Kimchi and OpenCode rely on instruction files instead.

## Context budgeting

How each agent manages the token window when context grows large.

Acolyte budgets context **before assembly** and maintains a bounded running context window. It reserves known prompt costs, keeps recent conversation within the remaining budget, and caps tool results individually. When earlier conversation falls outside the window, the model receives an explicit gap notice and can retrieve it with `session-search`. Durable session, project, and user context remains available through on-demand `memory-search`, not upfront prompt injection.

The other projects mostly compact: earlier conversation becomes a summary the model cannot look behind. Goose exposes a `chatrecall` extension and Reasonix a `history` tool, both of which search saved sessions, so their agents can also reach past turns. Acolyte keeps its live window bounded and retrieves earlier or durable context on demand rather than compacting the conversation into a replacement summary. Each completed request also reports input, output, total, and prompt-breakdown token counts. See [Context Budgeting](./context-budgeting.md) for the runtime behavior.

## Code quality

See [Benchmarks](./benchmarks.md) for the measured source comparison. At the recorded snapshot, Acolyte has the smallest measured source set, smallest average module size, fewest runtime dependencies, and highest measured TypeScript validation-call density in the selected peer set.

These are static engineering signals. They do not establish task success, model quality, security equivalence, or overall product superiority. Each figure covers a project's own source, so Kimchi's excludes the pi harness it imports.

Reviewed against the revisions recorded in [Benchmarks](./benchmarks.md).

Updated 3 August 2026.
