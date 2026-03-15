# Comparison

Detailed feature comparison between Acolyte and other open-source AI coding agents. See [Why Acolyte](./why-acolyte.md) for a summary.

Projects compared: [Aider](https://github.com/Aider-AI/aider), [OpenCode](https://github.com/anomalyco/opencode), [Pi](https://github.com/badlogic/pi-mono), [Goose](https://github.com/block/goose), [OpenHands](https://github.com/All-Hands-AI/OpenHands), [Continue](https://github.com/continuedev/continue), [Cline](https://github.com/cline/cline), [OpenClaw](https://github.com/openclaw/openclaw), [Plandex](https://github.com/plandex-ai/plandex).

## Feature overview

| Capability | Acolyte | Aider | OpenCode | Goose | OpenHands | Continue | Cline | OpenClaw | Plandex |
|---|---|---|---|---|---|---|---|---|---|
Lifecycle pipeline | ✓ | ✗ | ✗ | partial | partial | ✗ | ✗ | ✗ | ✗ |
Behavioral guards | ✓ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | partial | ✗ |
Auto verification | ✓ | ✗ | ✗ | partial | partial | ✗ | ✗ | ✗ | ✗ |
Task state machine | ✓ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | ✗ | ✗ |
Observable execution | ✓ | partial | partial | partial | partial | ✗ | ✗ | ✗ | ✗ |
Daemon architecture | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ |

---

# Architecture

| Project | Architecture | Deployment model |
|---|---|---|
| **Acolyte** | Headless daemon + typed RPC clients | daemon |
| Aider | Pure CLI process | single-process |
| OpenCode | HTTP/WebSocket server + TUI/desktop clients | server |
| Pi | SDK with RPC as one mode | embedded |
| Goose | Single-process with MCP extensions | single-process |
| Continue | VS Code / JetBrains extension + CLI | extension |
| Cline | VS Code extension + CLI | extension |
| OpenHands | Web platform with Docker sandboxing | platform |
| OpenClaw | Node.js gateway + WebSocket control plane | server |
| Plandex | Go CLI agent with long-running planner | single-process |

Acolyte runs as a headless daemon. The CLI, future editor plugins, and third-party clients all connect over the same typed RPC protocol.

The optional TUI is a custom React terminal renderer built on `react-reconciler` and provides an interactive CLI experience.

---

# Lifecycle pipeline

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

Evaluators (for example `multiMatchEditEvaluator` and `verifyCycle`) run after generation and may return a `regenerate` action. Evaluators can also change the agent mode (work ↔ verify), causing the lifecycle to re-run the generate phase under the new mode.

Most other agents use flat tool loops or implicit state machines.

Goose comes closest with `prepare → generate → categorize → execute`, but the phases are orchestrated inside a single streaming loop.

---

# Tool guards

Autonomous coding agents frequently enter degenerate loops:

- repeated edits
- redundant file reads
- repeated searches
- verification cycles with no changes

Acolyte uses behavioral guards that run before every tool call.

| Guard id | Purpose |
|---|---|
| `duplicate-call` | Prevent duplicate tool calls within the same turn |
| `file-churn` | Detect read/edit loops against the same file |
| `redundant-find` | Block narrower file discovery after broader calls |
| `redundant-search` | Block redundant search-files calls |
| `redundant-verify` | Prevent verify when no write tools ran |
| `step-budget` | Enforce per-cycle and total step budgets |

Only OpenClaw and OpenHands ship comparable runtime safeguards.

Others rely primarily on prompt instructions or user confirmation.

---

# Auto-verification

After generation, evaluators inspect the result and may trigger:

- regeneration with a different tool strategy
- mode transitions (work → verify)
- verify cycles that automatically run project checks

Goose has a `RetryManager` that checks shell command success.

OpenHands has a **Critic** that scores outcomes but does not automatically retry.

Most other agents rely on prompt instructions such as "please run the tests".

---

# Developer experience

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

---

# Observability

Every lifecycle event emits structured debug logs describing:

- tool calls
- guard decisions
- evaluator actions
- task state transitions

A dedicated trace tool (`scripts/lifecycle-trace.ts`) converts daemon logs into timelines:


```
task_id=task_abc123
2026-03-10T10:00:01 lifecycle.tool.call tool=edit-file path=src/foo.ts
2026-03-10T10:00:02 lifecycle.tool.result tool=edit-file duration_ms=45 is_error=false
2026-03-10T10:00:02 lifecycle.guard guard=file-churn tool=read-file action=blocked
2026-03-10T10:00:03 lifecycle.eval.decision evaluator=verifyCycle action=regenerate
2026-03-10T10:00:05 lifecycle.summary model_calls=2 total_tool_calls=8 guard_blocked=1
```

These traces allow developers to debug agent behavior step-by-step.

Most other agents expose only console logs or partial traces.

---

# Code quality

Across the benchmarked projects, Acolyte leads on:

- type safety
- dependency footprint
- module size
- tech-debt markers

These characteristics reflect architectural choices:

- few dependencies because the daemon owns the stack
- small modules because lifecycle phases and tools are isolated
- high test density because modules are independently testable

See [Benchmarks](./benchmarks.md) for full measured comparisons.

---

# Task architecture

Every chat request becomes a **task** with a state machine:

```
accepted → queued → running → completed | failed | cancelled
```

Tasks are durable entities with stable IDs and explicit state transitions.

Guards, evaluators, and tool call logs are isolated per task.

The RPC protocol exposes task transitions so clients can show real-time progress.

Most other agents run requests inline or use implicit controller state.

---

# Skills and extensibility

Acolyte supports the [SKILL.md standard](https://agentskills.io) for declarative prompt extensions.

Skills live in `.agents/skills/` and are invoked via slash commands.

OpenCode, Pi, and Cline also implement the SKILL.md standard.

Goose instead uses MCP-based extensions.

Other agents have limited or no plugin systems.

---

# Extension seams

Core systems expose minimal, well-defined extension points:

- lifecycle policies
- tool registration
- guard hooks
- memory strategies
- skill metadata
- configuration layers

Extensions implement typed contracts. The surface is intentionally narrow — Acolyte is an opinionated product, not a general-purpose agent framework.

---

# Memory

| Project | Approach |
|---|---|
| **Acolyte** | Context distillation to 3-tier persistent memory |
| OpenHands | Microagent recall + condenser pipeline |
| OpenClaw | Vector search via LanceDB |
| Goose | Session search via MCP |
| Continue | Codebase embeddings (deprecated) |
| Aider | Repository map + chat restore |
| Cline | Task history persistence |
| OpenCode, Pi | No cross-session memory |
| Plandex | Session-based planning memory |

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

---

# Context budgeting

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
| Plandex | Conversation summarization on token limit |

Acolyte budgets context **before assembly** using `tiktoken`.

Key behaviors:

- system prompt reservation
- priority-based context allocation
- age-based tool compaction
- visible truncation notices

---

# Further reading

- [How to Write Better AGENTS.md?](https://arxiv.org/abs/2602.11988)
- [Benchmarks](./benchmarks.md)