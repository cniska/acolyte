# Why Acolyte

What makes Acolyte different from other open-source AI coding agents, based on direct analysis of their source code.

Projects compared: [Aider](https://github.com/Aider-AI/aider), [OpenCode](https://github.com/anomalyco/opencode), [Pi](https://github.com/badlogic/pi-mono), [Goose](https://github.com/block/goose), [OpenHands](https://github.com/All-Hands-AI/OpenHands), [Continue](https://github.com/continuedev/continue), [Cline](https://github.com/cline/cline), [OpenClaw](https://github.com/openclaw/openclaw).

## At a glance

| Feature | Acolyte | Best competitor | Others |
|---|---|---|---|
| Architecture | Headless daemon + typed RPC | Pi (SDK with RPC mode) | Monolithic CLI, IDE extension, or web platform |
| Lifecycle | 5-phase pipeline in separate modules | Goose (phases in one function) | Flat loops or state machines |
| Tool guards | Behavioral guards per tool call | OpenClaw (3 detectors) | 5 of 8 have none |
| Auto-verification | Evaluator-driven re-generation | Goose (RetryManager) | Prompt-based or none |
| Task model | First-class tasks with state machine + scoping | OpenHands (controller state) | Inline request handling |
| CLI | Ink TUI, fuzzy search, autocomplete, structured output | OpenCode (Bubbletea TUI) | Readline loops or IDE-only |
| Observability | Structured lifecycle trace tooling | — | None ship agent-readable trace tools |
| Extension seams | Interface-first boundaries, no plugin runtime | Goose (JS/TS extension runtime) | Framework-coupled or none |
| Dependencies | Fewest runtime deps | Pi (next fewest) | 112–480 |
| Code quality | Highest type safety, high test ratio | OpenHands (highest test ratio) | See [benchmarks](./benchmarks.md) |

Details for each feature below.

## Daemon architecture

Acolyte runs as a headless daemon. The CLI, future editor plugins, and third-party clients all connect over the same typed RPC protocol. The TUI is just another client — it has no special access to the server.

This means multiple clients can share the same session, and integrations don't require forking the project — they speak the protocol.

| Project | Architecture |
|---|---|
| **Acolyte** | Headless daemon + typed RPC clients |
| Aider | Pure CLI process |
| OpenCode | Monolithic CLI/TUI |
| Pi | SDK with RPC as one mode |
| Goose | Single-process with MCP extensions |
| Continue | VS Code / JetBrains extension |
| Cline | VS Code extension only |
| OpenHands | Web platform with Docker sandboxing |
| OpenClaw | Electron app + web |

## Lifecycle pipeline

Every request flows through five explicit phases, each in its own module with its own tests:

```
resolve → prepare → generate → evaluate → finalize
```

- **resolve**: pick mode (work/verify) and model
- **prepare**: wire tools, session context, and guards
- **generate**: run the model with tool calls
- **evaluate**: inspect output, decide accept/retry/re-generate
- **finalize**: persist results and emit the response

No other project separates lifecycle phases into independently testable modules. Goose comes closest with prepare→generate→categorize→execute, but it's embedded in a single function. The rest use flat loops or state machines.

## Tool guards

Behavioral guards run before every tool call and block degenerate patterns at runtime:

| Guard | What it blocks |
|---|---|
| `step-budget` | Per-cycle and total step limits |
| `duplicate-call` | Identical consecutive tool calls |
| `file-churn` | Excessive read/edit loops on the same file |
| `redundant-search` | Repeated search-only loops without reads/writes |
| `redundant-find` | Repeated find-only loops without reads/writes |
| `redundant-verify` | Re-running verify when nothing changed |
| `no-delete-rewrite` | Deleting a file that was already read (use edit instead) |

Only OpenClaw (3 detectors: genericRepeat, pingPong, knownPollNoProgress) and OpenHands (StuckDetector + 500-step limit) have comparable systems. Five of eight projects have no guard system at all.

## Auto-verification

After generation, evaluators inspect the result and can trigger:
- Re-generation with a different tool strategy (e.g. multi-match edit → retry with edit-code)
- Mode transitions (work → verify after writes)
- Verify cycles that auto-run project checks and re-generate on failure

Goose has a RetryManager with shell-command success checks. OpenHands has a Critic that scores outcomes but doesn't auto-retry. The rest either rely on prompt instructions ("please run the tests") or have no verification at all.

## Developer experience

The CLI is built with [Ink](https://github.com/vadimdemedes/ink) and ships a full TUI with:
- Structured tool output with typed rendering (bold labels, colored diffs, dim line numbers)
- Fuzzy search for sessions, commands, and skills
- Model picker that queries provider APIs for available models with autocomplete
- Session management with history navigation
- Daemon lifecycle commands with Docker-style output (start/stop/status)
- AST-based code editing and scanning via [ast-grep](https://ast-grep.github.io/)
- Slash commands and skill invocation

Most competing CLIs are basic readline loops (Aider) or full TUI frameworks that are hard to extend (OpenCode's Bubbletea). IDE-based agents (Cline, Continue) have no standalone CLI at all.

## Observability

The lifecycle emits structured debug events for every tool call, guard decision, evaluator action, and task state transition. A dedicated trace tool (`scripts/lifecycle-trace.ts`) parses daemon logs into compact timelines:

```
task_id=task_abc123
2026-03-10T10:00:01 lifecycle.tool.call tool=edit-file path=src/foo.ts
2026-03-10T10:00:02 lifecycle.tool.result tool=edit-file duration_ms=45 is_error=false
2026-03-10T10:00:02 lifecycle.guard guard=file-churn tool=read-file action=blocked
2026-03-10T10:00:03 lifecycle.eval.decision evaluator=verifyCycle action=regenerate
2026-03-10T10:00:05 lifecycle.summary model_calls=2 total_tool_calls=8 guard_blocked=1
```

The developer tooling — lifecycle trace, benchmarks, performance scenarios, fake provider server — was built by agents using Acolyte itself. No other project in this comparison ships agent-readable observability tooling for debugging agent behavior.

## Code quality

Acolyte leads on type safety, test density, module size, and dependency count across all eight projects compared. The numbers reflect architectural choices: few deps because the daemon owns the stack with no framework or bundler. Small files because lifecycle phases, guards, and tools are each their own module. High test ratio because each module is independently testable. Runs on [Bun](https://bun.sh) with no bundler or transpiler step.

See [benchmarks.md](./benchmarks.md) for the full measured comparison tables.

## Task architecture

Every chat request becomes a task with an explicit state machine:

```
accepted → queued → running → completed | failed | cancelled
```

Tasks are scoped — guards, evaluators, and tool call logs are isolated per task. The RPC protocol exposes task state transitions so clients can show real-time progress. Queue policy controls whether follow-up messages are held until the current task completes or delivered immediately.

Other projects either run requests inline (Aider, Cline) or have implicit task state (OpenHands controller). Only Acolyte models tasks as first-class entities with stable IDs, explicit state transitions, and per-task scoping of all lifecycle behavior.

## Skills and extensibility

Acolyte supports the [SKILL.md standard](https://agentskills.io) for declarative prompt extensions with frontmatter metadata, tool restrictions, and compatibility checks. Skills live in `.agents/skills/` and are invoked via slash commands.

OpenCode and Pi also implement the SKILL.md standard. Goose takes a different approach with a full JS/TS extension runtime. The rest have limited or no plugin systems.

## Extension seams

Every core system exposes just enough surface for customization without shipping a plugin runtime:

- **Lifecycle**: policy controls for step budgets, timeouts, and regeneration caps
- **Tools**: toolkit registration with permission categories and guard hooks
- **Guards**: pluggable guard array — add custom guards without touching the pipeline
- **Memory**: source registry with injectable normalization and selection strategies
- **Skills**: declarative SKILL.md files with tool restrictions and compatibility metadata
- **Transport**: protocol-first design — swap HTTP for WebSocket without changing lifecycle behavior
- **Config**: layered user/project configuration with structured validation

The principle is "interface-first boundaries" — clean contracts at every seam, but no plugin runtime, no dependency injection container, no extension API to maintain. When you need to extend, you implement a contract. When you don't, the defaults work.

## Memory

Most agents handle growing context through **compaction** — summarizing or truncating the conversation when it hits the token limit. Compaction is lossy by design: it fires under pressure, and important details get silently dropped. The agent forgets what it learned mid-session.

Acolyte takes a different approach with **context distillation**. Instead of compressing the conversation after the fact, the memory pipeline proactively extracts structured facts — observations, reflections, and corrections — from each conversation and commits them to persistent storage. These facts are recalled in future sessions, not just the current one.

Three-tier memory with async commit:
- **Session**: conversation context within a session
- **Project**: project-scoped persistent facts (e.g. architecture decisions, naming conventions)
- **User**: cross-project preferences (e.g. commit style, tool choices)

The pipeline is explicit: ingest → normalize → select → inject → commit. Each stage is strategy-injectable behind registry contracts — no monolithic summarizer, no opaque compression step.

| Project | Approach |
|---|---|
| **Acolyte** | Context distillation to 3-tier persistent memory |
| OpenClaw | Vector search + LanceDB (most mature retrieval) |
| Goose | MCP-based categorized memory |
| Continue | Retrieval from codebase embeddings |
| Aider | Repository map (no cross-session memory) |
| OpenCode, Pi, Cline | No persistent memory |
| OpenHands | Microagent recall (no distillation) |

Acolyte's distillation pipeline is newer than OpenClaw's retrieval system, but architecturally it solves a different problem: learning from conversations rather than searching stored documents. The current implementation is recency-based — there is no vector/semantic search. For a coding agent this is a reasonable tradeoff: the most relevant context is almost always the most recent. Semantic recall is on the roadmap for cases where older facts matter.

## Context budgeting

Most agents assemble prompts by concatenating system instructions, history, and user input — then hope it fits the model's context window. When it doesn't, messages are silently dropped or the API rejects the request.

Acolyte uses structured token budgeting with a real tokenizer ([tiktoken](https://github.com/openai/tiktoken)):

- **System prompt reservation**: the system prompt (soul, instructions, memory context) is measured first and its cost is reserved before history allocation begins
- **Priority-based filling**: pinned context (skills, memory) → file attachments → conversational history → tool payloads, each with configurable per-message caps
- **Age-based tool compaction**: recent tool outputs get full budget; older outputs are progressively capped (600 → 200 → 120 → 60 tokens based on age)
- **Visible truncation**: when output is compacted, the model sees an explicit truncation notice — no silent data loss

| Project | Token budgeting |
|---|---|
| **Acolyte** | Real tokenizer, system prompt reservation, priority-based allocation |
| OpenClaw | Token counting with model-specific limits |
| Aider | Repository map with token-aware ranking |
| Goose, OpenCode | Basic message truncation |
| Cline, Continue, Pi | Concatenate and hope |
