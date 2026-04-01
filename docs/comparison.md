# Comparison

Detailed feature comparison between Acolyte and other open-source AI agents. See [Why Acolyte](./why-acolyte.md) for a summary.

Projects compared: [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/openai/codex), [Crush](https://github.com/charmbracelet/crush), [Aider](https://github.com/Aider-AI/aider), [Goose](https://github.com/block/goose), [Cline](https://github.com/cline/cline), [Qwen Code](https://github.com/QwenLM/qwen-code), [OpenHands](https://github.com/All-Hands-AI/OpenHands), [Continue](https://github.com/continuedev/continue), [Plandex](https://github.com/plandex-ai/plandex), [Mistral Vibe](https://github.com/mistralai/mistral-vibe).

| Project | Category |
|---|---|
| Acolyte | Terminal coding agent |
| OpenCode | Terminal coding agent |
| Codex | Terminal coding agent |
| Crush | Terminal coding agent |
| Aider | Terminal coding agent |
| Goose | Terminal coding agent |
| Cline | IDE extension + CLI |
| Qwen Code | Terminal coding agent |
| OpenHands | Agent platform |
| Continue | IDE extension |
| Plandex | Terminal coding agent |
| Mistral Vibe | Terminal coding agent |

## Feature overview

High-level capability comparison across all projects.

| Capability | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Cline | Qwen Code | OpenHands | Continue | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Multi-provider | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Lifecycle pipeline | ✓ | ✗ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | partial | ✗ | ✗ | ✗ |
| Post-write effects | ✓ | ✗ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | partial | ✗ | ✗ | ✗ |
| Task state machine | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | ✗ |
| Workspace detection | ✓ | ✗ | ✗ | ✗ | partial | partial | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Workspace sandboxing | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Observable execution | ✓ | partial | partial | partial | partial | partial | ✗ | partial | partial | ✗ | ✗ | partial |
| Daemon architecture | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |

## Architecture

How each project structures its runtime and where it runs.

| Project | Architecture | Deployment model |
|---|---|---|
| **Acolyte** | Headless daemon + typed RPC clients | daemon |
| OpenCode | HTTP/WebSocket server + TUI/desktop clients | server |
| Codex | Rust CLI with optional Node.js wrapper | single-process |
| Crush | Go CLI with Bubble Tea TUI | single-process |
| Aider | Pure CLI process | single-process |
| Goose | Single-process with MCP extensions | single-process |
| Cline | VS Code extension + CLI | extension |
| Qwen Code | CLI (Gemini CLI fork) + IDE extensions | single-process |
| OpenHands | Web platform with Docker sandboxing | platform |
| Continue | VS Code / JetBrains extension + CLI | extension |
| Plandex | Go CLI agent with long-running planner | single-process |
| Mistral Vibe | Python CLI with Devstral models | single-process |

Acolyte runs as a headless daemon. The CLI, future editor plugins, and third-party clients all connect over the same typed RPC protocol.

The optional TUI is a custom React terminal renderer built on `react-reconciler` and provides an interactive CLI experience.

## Lifecycle pipeline

Acolyte separates the agent lifecycle into explicit phases with strict contracts between them.

Every request flows through four phases, each implemented as its own module with its own tests:

```
resolve → prepare → generate → finalize
```

- **resolve**: pick model and policy
- **prepare**: wire tools and session context
- **generate**: run the model with tool calls (single pass, effects apply per-tool-result)
- **finalize**: accept lifecycle signal, persist results, emit the response

The lifecycle trusts the model to make good decisions within a single generation pass. Format and lint effects run automatically after writes, and lint errors surface in the tool result for the model to decide on.

Most other agents use flat tool loops or implicit state machines.

Goose comes closest with `prepare → generate → categorize → execute`, but the phases are orchestrated inside a single streaming loop.

## Step budget

A step budget inlined into tool execution enforces per-cycle and total tool-call limits to prevent runaway loops. When the budget is exhausted, the tool call is blocked. This is a lightweight runtime safeguard rather than a pluggable guard system.

## Post-write effects

After generation, format and lint effects run automatically on written files:

- format applies the detected workspace formatter
- lint runs the detected workspace linter; errors surface in the tool result for the model to decide on
- scoped test execution is available via the `test-run` tool during generation

The model uses an ecosystem-aware `test-run` tool to validate changes against specific test files rather than running the full test suite.

Goose has a `RetryManager` that checks shell command success.

OpenHands has a **Critic** that scores outcomes but does not automatically retry.

Most other agents rely on prompt instructions such as "please run the tests".

## Workspace detection

Acolyte auto-detects project tooling from workspace config files at lifecycle start. The detected profile includes ecosystem, package manager, lint command, format command, and test command. Detection is cached per workspace and feeds into the lifecycle policy and agent instructions.

| Project | Detection approach |
|---|---|
| **Acolyte** | Auto-detect from config files (biome.json, ruff.toml, Cargo.toml, go.mod, etc.) |
| Aider | User-configured per-language lint commands (`--lint-cmd`) |
| Cline | User-written `.clinerules` prose |
| Continue | IDE-provided workspace context |
| Goose | Package manager detection via Rust crate |
| Others | No workspace detection |

## Workspace sandboxing

Acolyte enforces a workspace sandbox that prevents tool operations outside the resolved workspace root. All file paths are validated against the sandbox boundary using `realpath`-based resolution before any read, write, or delete operation.

| Project | Sandboxing approach |
|---|---|
| **Acolyte** | Path validation against resolved workspace root |
| Codex | Network-disabled sandbox with writable directory restrictions |
| OpenHands | Docker container isolation |
| Others | No sandboxing |

## Developer experience

The CLI ships a custom React terminal renderer built on `react-reconciler` with a full TUI:

- Structured tool output with typed rendering
- Colored diffs and contextual output
- Fuzzy search and autocomplete
- Model picker that queries provider APIs
- Session management and history navigation
- Daemon lifecycle commands (`start`, `stop`, `status`)
- AST-based code editing via [ast-grep](https://ast-grep.github.io/)
- Slash commands and skill invocation

Most competing CLIs use `prompt-toolkit` (Aider) or custom TUI frameworks (OpenCode).

IDE-based agents such as Cline and Continue primarily operate through extensions.

## Observability

Every lifecycle event emits structured debug logs describing:

- Tool calls
- Effect decisions
- Task state transitions

The `acolyte trace` command converts daemon logs into timelines:

```
timestamp=... task_id=task_abc123 event=lifecycle.tool.call tool=file-edit path=src/foo.ts
timestamp=... task_id=task_abc123 event=lifecycle.tool.result tool=file-edit duration_ms=45 is_error=false
timestamp=... task_id=task_abc123 event=lifecycle.eval.decision effect=lint action=done
timestamp=... task_id=task_abc123 event=lifecycle.summary model_calls=1 read=3 search=1 write=1
```

These traces allow developers to debug agent behavior step-by-step.

Most other agents expose only console logs or partial traces.

## Code quality

Across the benchmarked projects, Acolyte leads on:

- Type safety
- Dependency footprint
- Module size


These characteristics reflect architectural choices:

- Few dependencies because external packages are only added when strictly necessary
- Small modules because clear boundaries and contracts keep each one focused
- High test density because modules are independently testable

See [Benchmarks](./benchmarks.md) for full measured comparisons.

## Task architecture

Every chat request becomes a **task** with a state machine:

```
accepted → queued → running → completed | failed | cancelled
```

Tasks are durable entities with stable IDs and explicit state transitions.

Tool call logs and lifecycle events are isolated per task.

The RPC protocol exposes task transitions so clients can show real-time progress.

Most other agents run requests inline or use implicit controller state.

## Skills and extensibility

Acolyte supports the [SKILL.md standard](https://agentskills.io) for declarative prompt extensions.

Skills live in `.agents/skills/` and are invoked via slash commands.

OpenCode, Crush, Cline, Qwen Code, and Mistral Vibe also implement the SKILL.md standard.

Goose instead uses MCP-based extensions.

Other agents have limited or no plugin systems.

## Extension seams

Core systems expose minimal, well-defined extension points:

- Lifecycle policies
- Tool registration
- Memory strategies
- Skill metadata
- Configuration layers

Extensions implement typed contracts. The surface is intentionally narrow — Acolyte is an opinionated product, not a general-purpose agent framework.

## Memory

How each agent retains knowledge across sessions.

| Project | Approach |
|---|---|
| **Acolyte** | Context distillation to 3-tier persistent memory with semantic recall |
| OpenHands | Microagent recall + condenser pipeline |
| Goose | Session search via MCP |
| Continue | Codebase embeddings (deprecated) |
| Aider | Repository map + chat restore |
| Cline | Task history persistence |
| Plandex | Session-based planning memory |
| Codex, OpenCode, Crush, Qwen Code, Mistral Vibe | No cross-session memory |

Most agents manage context through **compaction** (summarization or truncation).

Acolyte instead uses **context distillation**:

```
ingest → normalize → select → inject → commit
```

Facts extracted from conversations persist across sessions.

Memory tiers:

- **Session**
- **Project**
- **User**

At query time, entries are ranked by semantic similarity to the current task using provider embeddings and cosine similarity. Records without embeddings fall back to recency ordering.

## Context budgeting

How each agent manages the token window when context grows large.

| Project | Token budgeting |
|---|---|
| **Acolyte** | Proactive budgeting with token measurement |
| OpenCode | LLM compaction |
| Codex | Conversation truncation |
| Crush | Conversation truncation |
| Aider | Repo map ranking |
| Goose | Summarization fallback |
| Cline | Window truncation |
| Qwen Code | Conversation truncation |
| OpenHands | Condenser pipeline |
| Continue | Retrieval parameters |
| Plandex | Conversation summarization on token limit |
| Mistral Vibe | Conversation truncation |

Acolyte budgets context **before assembly** using [tiktoken](https://github.com/openai/tiktoken).

Key behaviors:

- System prompt reservation
- Priority-based context allocation
- Age-based tool compaction
- Visible truncation notices
