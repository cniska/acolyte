# Why Acolyte

What makes Acolyte different from other open-source AI coding agents, based on direct analysis of their source code.

Projects compared: [Aider](https://github.com/Aider-AI/aider), [OpenCode](https://github.com/anomalyco/opencode), [Pi](https://github.com/badlogic/pi-mono), [Goose](https://github.com/block/goose), [OpenHands](https://github.com/All-Hands-AI/OpenHands), [Continue](https://github.com/continuedev/continue), [Cline](https://github.com/cline/cline), [OpenClaw](https://github.com/openclaw/openclaw).

## At a glance

| Feature | Acolyte | Best competitor | Others |
|---|---|---|---|
| Architecture | Headless daemon + typed RPC | Pi (SDK with RPC mode) | Monolithic CLI, IDE extension, or web platform |
| Lifecycle | 5-phase pipeline in separate modules | Goose (phases in one function) | Flat loops or state machines |
| Tool guards | 8 behavioral guards | OpenClaw (3 detectors) | 5 of 8 have none |
| Auto-verification | Evaluator-driven re-generation | Goose (RetryManager) | Prompt-based or none |
| Task model | First-class tasks with state machine + scoping | OpenHands (controller state) | Inline request handling |
| CLI | Ink TUI, fuzzy search, autocomplete, structured output | OpenCode (Bubbletea TUI) | Readline loops or IDE-only |
| Observability | Structured lifecycle trace tooling | — | None ship agent-readable trace tools |
| Extension seams | Interface-first boundaries, no plugin runtime | Goose (JS/TS extension runtime) | Framework-coupled or none |
| Dependencies | 12 runtime | Pi (50) | 112–480 |
| Code quality | 0.06 `any`/1k, 0.90 test ratio | OpenHands (1.14 test ratio) | See [benchmarks](./benchmarks.md) |

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
classify → prepare → generate → evaluate → finalize
```

- **classify**: pick mode (plan/work/verify) and model
- **prepare**: wire tools, session context, and guards
- **generate**: run the model with tool calls
- **evaluate**: inspect output, decide accept/retry/re-generate
- **finalize**: persist results and emit the response

No other project separates lifecycle phases into independently testable modules. Goose comes closest with prepare→generate→categorize→execute, but it's embedded in a single function. The rest use flat loops or state machines.

## Tool guards

Eight behavioral guards run before every tool call and block degenerate patterns at runtime:

| Guard | What it blocks |
|---|---|
| `step-budget` | Per-cycle and total step limits |
| `duplicate-call` | Identical consecutive tool calls |
| `file-churn` | Excessive read/edit loops on the same file |
| `redundant-search` | Repeated search-only loops without reads/writes |
| `redundant-find` | Repeated find-only loops without reads/writes |
| `redundant-verify` | Re-running verify when nothing changed |
| `no-delete-rewrite` | Deleting a file that was already read (use edit instead) |
| `mode-promotion` | Auto-promote plan → work when a write tool is called |

Only OpenClaw (3 detectors: genericRepeat, pingPong, knownPollNoProgress) and OpenHands (StuckDetector + 500-step limit) have comparable systems. Five of eight projects have no guard system at all.

## Auto-verification

After generation, evaluators inspect the result and can trigger:
- Re-generation with adjusted parameters
- Mode transitions (e.g. work → verify)
- Verify cycles that run project checks automatically
- Timeout recovery

Goose has a RetryManager with shell-command success checks. OpenHands has a Critic that scores outcomes but doesn't auto-retry. The rest either rely on prompt instructions ("please run the tests") or have no verification at all.

## Developer experience

The CLI is built with [Ink](https://github.com/vadimdemedes/ink) and ships a full TUI with:
- Structured tool output with typed rendering (bold labels, colored diffs, dim line numbers)
- Fuzzy search for sessions, commands, and skills
- Autocomplete with suggestion and correction
- Session management with history navigation
- Daemon lifecycle commands with Docker-style output (start/stop/status)
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

Measured comparisons against all eight projects — see [benchmarks.md](./benchmarks.md) for the full tables.

| Metric | Acolyte | Range across others |
|---|---|---|
| Source lines | 18,005 | 25k–628k |
| Runtime dependencies | 12 | 50–480 |
| `any` per 1k lines | 0.06 | 0.1–4.2 |
| Test/source ratio | 0.90 | 0.04–1.14 |
| Avg lines/file | 128 | 157–438 |
| TODO/FIXME per 1k | 0.0 | 0.0–0.8 |
| `.safeParse()` per 1k | 1.5 | 0.0–0.1 |

The numbers reflect architectural choices: 12 deps because the daemon owns the stack with no framework or bundler. Small files because lifecycle phases, guards, and tools are each their own module. High test ratio because each module is independently testable.

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

Three-tier memory with async commit:
- **Session**: conversation context within a session
- **Project**: project-scoped persistent facts
- **User**: cross-project preferences

Context distillation automatically extracts observations and reflections from conversations.

OpenClaw has the most mature memory (vector search + LanceDB). Goose has MCP-based categorized memory. Acolyte's distillation pipeline is architecturally clean but newer.
