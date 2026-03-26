# Comparison

Detailed feature comparison between Acolyte and other open-source AI agents. See [Why Acolyte](./why-acolyte.md) for a summary.

Projects compared: [Codex](https://github.com/openai/codex), [Aider](https://github.com/Aider-AI/aider), [Plandex](https://github.com/plandex-ai/plandex), [OpenCode](https://github.com/anomalyco/opencode), [Pi](https://github.com/badlogic/pi-mono), [Continue](https://github.com/continuedev/continue), [Cline](https://github.com/cline/cline), [OpenHands](https://github.com/All-Hands-AI/OpenHands), [Goose](https://github.com/block/goose), [OpenClaw](https://github.com/openclaw/openclaw).

The comparison spans different categories — not all projects are pure coding agents.

| Project | Category |
|---|---|
| Acolyte | Terminal coding agent |
| Codex | Terminal coding agent |
| Aider | Terminal coding agent |
| Plandex | Terminal coding agent |
| OpenCode | Coding agent (TUI/web/desktop) |
| Pi | Agent SDK harness |
| Continue | IDE extension |
| Cline | IDE extension |
| OpenHands | Agent platform |
| Goose | Developer productivity agent |
| OpenClaw | Personal AI assistant |

## Feature overview

High-level capability comparison across all projects.

| Capability | Acolyte | Codex | Aider | Plandex | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Multi-provider | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Lifecycle pipeline | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | partial | partial | ✗ | ✗ | ✗ |
| Behavioral guards | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | partial |
| Auto verification | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | partial | partial | ✗ | ✗ | ✗ |
| Task state machine | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | ✗ |
| Workspace detection | ✓ | ✗ | partial | ✗ | ✗ | ✗ | partial | ✗ | ✗ | ✗ | ✗ |
| Observable execution | ✓ | partial | partial | ✗ | partial | ✗ | partial | partial | ✗ | ✗ | ✗ |
| Daemon architecture | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ |

## Architecture

How each project structures its runtime and where it runs.

| Project | Architecture | Deployment model |
|---|---|---|
| **Acolyte** | Headless daemon + typed RPC clients | daemon |
| Codex | Rust CLI with optional Node.js wrapper | single-process |
| Aider | Pure CLI process | single-process |
| Plandex | Go CLI agent with long-running planner | single-process |
| OpenCode | HTTP/WebSocket server + TUI/desktop clients | server |
| Pi | SDK with RPC as one mode | embedded |
| Continue | VS Code / JetBrains extension + CLI | extension |
| Cline | VS Code extension + CLI | extension |
| OpenHands | Web platform with Docker sandboxing | platform |
| Goose | Single-process with MCP extensions | single-process |
| OpenClaw | Node.js gateway + WebSocket control plane | server |

Acolyte runs as a headless daemon. The CLI, future editor plugins, and third-party clients all connect over the same typed RPC protocol.

The optional TUI is a custom React terminal renderer built on `react-reconciler` and provides an interactive CLI experience.

## Lifecycle pipeline

Acolyte separates the agent lifecycle into explicit phases with strict contracts between them.

Every request flows through five phases, each implemented as its own module with its own tests:

```
resolve → prepare → generate → evaluate → finalize
```

- **resolve**: pick mode (work/verify) and model
- **prepare**: wire tools, session context, and guards
- **generate**: run the model with tool calls
- **evaluate**: inspect output, decide accept or regenerate
- **finalize**: persist results and emit the response

Evaluators (for example `lintEvaluator` and the verify-cycle evaluator) run after generation and may return a `regenerate` action. The verify-cycle evaluator transitions to verify mode for code review after writes, causing the lifecycle to re-run the generate phase under the new mode.

Most other agents use flat tool loops or implicit state machines.

Goose comes closest with `prepare → generate → categorize → execute`, but the phases are orchestrated inside a single streaming loop.

## Tool guards

Autonomous coding agents frequently enter degenerate loops:

- Repeated edits
- Redundant file reads
- Repeated searches
- Verification cycles with no changes

Acolyte uses behavioral guards that run before every tool call. Guards cover step budgets, duplicate/redundant calls, file churn, ping-pong loops, and lifecycle command enforcement. See `src/tool-guards.ts` for the full set.

Only OpenClaw and OpenHands ship comparable runtime safeguards.

Others rely primarily on prompt instructions or user confirmation.

## Auto-verification

After generation, evaluators inspect the result and may trigger:

- Regeneration with a different tool strategy
- Mode transitions (work → verify) for code review
- Scoped test execution via the `run-tests` tool during work mode

The model uses an ecosystem-aware `run-tests` tool to validate changes against specific test files rather than running the full test suite. Verify mode focuses on code review — scanning edited files with AST pattern matching.

Goose has a `RetryManager` that checks shell command success.

OpenHands has a **Critic** that scores outcomes but does not automatically retry.

Most other agents rely on prompt instructions such as "please run the tests".

## Workspace detection

Acolyte auto-detects project tooling from workspace config files at lifecycle start. The detected profile includes ecosystem, package manager, lint command, format command, test command, and line width. Detection is cached per workspace and feeds into the lifecycle policy and agent instructions.

| Project | Detection approach |
|---|---|
| **Acolyte** | Auto-detect from config files (biome.json, ruff.toml, Cargo.toml, go.mod, etc.) |
| Aider | User-configured per-language lint commands (`--lint-cmd`) |
| Cline | User-written `.clinerules` prose |
| Continue | IDE-provided workspace context |
| Goose | Package manager detection via Rust crate |
| Others | No workspace detection |

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
- Guard decisions
- Evaluator actions
- Task state transitions

The `acolyte trace` command converts daemon logs into timelines:

```
timestamp=... task_id=task_abc123 event=lifecycle.tool.call tool=edit-file path=src/foo.ts
timestamp=... task_id=task_abc123 event=lifecycle.tool.result tool=edit-file duration_ms=45 is_error=false
timestamp=... task_id=task_abc123 event=lifecycle.guard guard=file-churn tool=read-file action=blocked
timestamp=... task_id=task_abc123 event=lifecycle.eval.decision evaluator=verify-cycle action=regenerate
timestamp=... task_id=task_abc123 event=lifecycle.summary model_calls=2 read=3 search=1 write=1 guard_blocked=1
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

Guards, evaluators, and tool call logs are isolated per task.

The RPC protocol exposes task transitions so clients can show real-time progress.

Most other agents run requests inline or use implicit controller state.

## Skills and extensibility

Acolyte supports the [SKILL.md standard](https://agentskills.io) for declarative prompt extensions.

Skills live in `.agents/skills/` and are invoked via slash commands.

OpenCode, Pi, and Cline also implement the SKILL.md standard.

Goose instead uses MCP-based extensions.

Other agents have limited or no plugin systems.

## Extension seams

Core systems expose minimal, well-defined extension points:

- Lifecycle policies
- Tool registration
- Guard hooks
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
| OpenClaw | Vector search via LanceDB |
| Goose | Session search via MCP |
| Continue | Codebase embeddings (deprecated) |
| Aider | Repository map + chat restore |
| Cline | Task history persistence |
| Plandex | Session-based planning memory |
| Codex, OpenCode, Pi | No cross-session memory |

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
| OpenHands | Condenser pipeline |
| Goose | Summarization fallback |
| OpenCode | LLM compaction |
| Aider | Repo map ranking |
| OpenClaw | Token counting |
| Cline | Window truncation |
| Pi | Branch summarization |
| Continue | Retrieval parameters |
| Codex | Conversation truncation |
| Plandex | Conversation summarization on token limit |

Acolyte budgets context **before assembly** using [tiktoken](https://github.com/openai/tiktoken).

Key behaviors:

- System prompt reservation
- Priority-based context allocation
- Age-based tool compaction
- Visible truncation notices
