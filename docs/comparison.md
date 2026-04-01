# Comparison

Detailed feature comparison between Acolyte and other open-source terminal coding agents.

See [Why Acolyte](./why-acolyte.md) for a summary.

Projects compared: [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/openai/codex), [Crush](https://github.com/charmbracelet/crush), [Aider](https://github.com/Aider-AI/aider), [Goose](https://github.com/block/goose), [Qwen Code](https://github.com/QwenLM/qwen-code), [Plandex](https://github.com/plandex-ai/plandex), [Mistral Vibe](https://github.com/mistralai/mistral-vibe).

## Feature overview

| Capability | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Multi-provider | ✓ | ✓ | partial | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Daemon architecture | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Lifecycle pipeline | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Lifecycle effects | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Workspace detection | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Workspace sandboxing | ✓ | partial | ✓ | ✗ | ✗ | partial | ✓ | ✗ | ✗ |
| Observable execution | ✓ | partial | partial | partial | partial | partial | partial | partial | partial |
| SKILL.md support | ✓ | partial | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |

## Architecture

| Project | Architecture | Deployment model |
|---|---|---|
| **Acolyte** | Headless daemon + typed RPC clients | daemon |
| OpenCode | HTTP/WebSocket server + TUI/desktop clients | daemon |
| Codex | Rust CLI with optional Node.js wrapper | single-process |
| Crush | Go CLI with Bubble Tea TUI | single-process |
| Aider | Pure CLI process | single-process |
| Goose | Single-process with MCP extensions | single-process |
| Qwen Code | CLI (Gemini CLI fork) + IDE extensions | single-process |
| Plandex | Go CLI agent with long-running planner | single-process |
| Mistral Vibe | Python CLI with Devstral models | single-process |

Acolyte runs as a headless daemon. The CLI, future editor plugins, and third-party clients all connect over the same typed RPC protocol.

Every chat request becomes a task with a state machine (`accepted → queued → running → completed | failed | cancelled`). Tasks are durable entities with stable IDs and explicit state transitions. The RPC protocol exposes task transitions so clients can show real-time progress.

The TUI is a custom React terminal renderer built on `react-reconciler`. Most competing CLIs use `prompt-toolkit` (Aider), Bubble Tea (Crush), or custom TUI frameworks (OpenCode).

## Lifecycle pipeline

Every request flows through four phases, each implemented as its own module with its own tests:

```
resolve → prepare → generate → finalize
```

- **resolve**: pick model and policy
- **prepare**: wire tools and session context
- **generate**: run the model with tool calls, effects apply per-tool-result
- **finalize**: accept lifecycle signal, persist results, emit the response

The lifecycle trusts the model to make good decisions. Format and lint effects run automatically after writes, and lint errors surface in the tool result for the model to decide on. A step budget inlined into tool execution enforces per-cycle and total tool-call limits to prevent runaway loops.

Most other agents use flat tool loops or implicit state machines. Goose comes closest with `prepare → generate → categorize → execute`, but the phases are orchestrated inside a single streaming loop.

## Workspace detection

Acolyte auto-detects project tooling from workspace config files at lifecycle start. The detected profile includes ecosystem, package manager, lint command, format command, and test command. Detection is cached per workspace and feeds into the lifecycle policy and agent instructions.

| Project | Detection approach |
|---|---|
| **Acolyte** | Auto-detect from config files (biome.json, ruff.toml, Cargo.toml, go.mod, etc.) |
| Aider | User-configured per-language lint commands (`--lint-cmd`) |
| Others | No workspace detection |

## Workspace sandboxing

Acolyte enforces a workspace sandbox that prevents tool operations outside the resolved workspace root. All file paths are validated against the sandbox boundary using `realpath`-based resolution before any read, write, or delete operation.

| Project | Sandboxing approach |
|---|---|
| **Acolyte** | Path validation against resolved workspace root |
| Codex | Network-disabled sandbox with writable directory restrictions |
| Qwen Code | Path validation for shell and skills |
| Others | No sandboxing |

## Observability

Every lifecycle event emits structured debug logs describing tool calls, effect decisions, and task state transitions.

The `acolyte trace` command converts daemon logs into timelines:

```
timestamp=... task_id=task_abc123 event=lifecycle.tool.call tool=file-edit path=src/foo.ts
timestamp=... task_id=task_abc123 event=lifecycle.tool.result tool=file-edit duration_ms=45 is_error=false
timestamp=... task_id=task_abc123 event=lifecycle.eval.decision effect=lint action=done
timestamp=... task_id=task_abc123 event=lifecycle.summary model_calls=1 read=3 search=1 write=1
```

Most other agents expose only console logs or partial traces.

## Skills and extensibility

Acolyte supports the [SKILL.md standard](https://agentskills.io) for declarative prompt extensions. Skills live in `.agents/skills/` and are invoked via slash commands.

OpenCode, Crush, Qwen Code, and Mistral Vibe also implement the SKILL.md standard. Goose uses MCP-based extensions instead.

Core systems expose minimal, well-defined extension points: lifecycle policies, tool registration, memory strategies, skill metadata, and configuration layers. The surface is intentionally narrow — Acolyte is an opinionated product, not a general-purpose agent framework.

## Memory

How each agent retains knowledge across sessions.

| Project | Approach |
|---|---|
| **Acolyte** | Context distillation to 3-tier persistent memory with semantic recall |
| Goose | Session search via MCP |
| Aider | Repository map + chat restore |
| Plandex | Session-based planning memory |
| Others | No cross-session memory |

Acolyte uses **context distillation** (`ingest → normalize → select → inject → commit`) rather than compaction. Facts extracted from conversations persist across sessions in three tiers: session, project, and user. At query time, entries are ranked by semantic similarity using provider embeddings and cosine similarity.

## Context budgeting

How each agent manages the token window when context grows large.

| Project | Token budgeting |
|---|---|
| **Acolyte** | Proactive budgeting with token measurement |
| OpenCode | LLM compaction |
| Aider | Repo map ranking |
| Goose | Summarization fallback |
| Plandex | Conversation summarization on token limit |
| Others | Conversation truncation |

Acolyte budgets context **before assembly** using [tiktoken](https://github.com/openai/tiktoken): system prompt reservation, priority-based context allocation, age-based tool compaction, and visible truncation notices.

## Code quality

See [Benchmarks](./benchmarks.md) for full measured comparisons. Across the benchmarked projects, Acolyte leads on type safety, dependency footprint, and module size — reflecting architectural choices around minimal dependencies, clear boundaries, and independently testable modules.
