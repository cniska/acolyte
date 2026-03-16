# Why Acolyte?

> **TL;DR** — Acolyte is an open-source, terminal-first AI coding agent built for reliable agent behavior: it prevents drift, stops redundant work, verifies its own output, and preserves context across sessions. It runs as a headless daemon, supports any LLM provider, and gives you full control — behavioral guards, a 5-phase lifecycle pipeline, auto-verification, context distillation, and real token budgeting built in. These are things most open-source agents don't have, and closed-source agents don't let you touch.

## Why open source?

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/introducing-codex/) are excellent products. If you're happy with a single provider's CLI and don't need to customize agent behavior, they're the easiest path.

Open-source agents like Acolyte exist for the cases where that's not enough:

- **Provider choice**: use OpenAI, Anthropic, Google, or any OpenAI-compatible endpoint — switch models per task without switching tools
- **Self-hosted**: run everything on your own infrastructure with no data leaving your network
- **Customizable agent behavior**: lifecycle phases, guards, evaluators, and memory strategies are all configurable — not locked behind a closed product surface
- **Transparent execution**: every tool call, guard decision, and evaluator action is observable in structured logs — no black box
- **No vendor lock-in**: your sessions, memory, and configuration are local files you own

Acolyte is for developers who want reliable, observable agent behavior — not a black box. Ready to try it? See the [Quick Start](../README.md#quick-start).

## What makes Acolyte different

| Feature | What Acolyte does |
|---|---|
| Architecture | Headless daemon with typed RPC — CLI, editors, and custom clients share the same protocol |
| Lifecycle | 5-phase pipeline (resolve → prepare → generate → evaluate → finalize) in separate, testable modules |
| Tool guards | Behavioral guards that detect and block degenerate patterns at runtime |
| Memory | Context distillation extracts facts from conversations into 3-tier persistent storage |
| Context budgeting | Proactive token budgeting via tiktoken with system prompt reservation and priority-based allocation |
| Developer experience | Custom React TUI with fuzzy search, autocomplete, model picker, structured output, and AST-based editing |

### Daemon architecture

The server runs headless. CLI, editor plugins, and third-party clients all connect over the same typed RPC protocol. The TUI is just another client — it has no special access. Multiple clients can share a session, and integrations speak the protocol instead of forking the project.

### Lifecycle pipeline

Every request flows through five explicit phases, each in its own module with its own tests. Evaluators inspect output after generation and can trigger re-generation, mode transitions, or verify cycles — no manual intervention needed.

### Tool guards

Behavioral guards run before every tool call: step budgets, duplicate detection, file churn limits, redundant search/find/verify blocking, and delete-rewrite prevention. Guards are pluggable — add custom guards without touching the pipeline.

### Memory

Instead of compressing context under pressure, Acolyte proactively extracts structured facts — observations, reflections, and corrections — and commits them to persistent storage across three tiers: session, project, and user. The pipeline is explicit and each stage is strategy-injectable.

### Context budgeting

The system prompt is measured and reserved before history allocation begins. Remaining budget is filled by priority: pinned context → file attachments → history → tool payloads. Older tool outputs are progressively capped. When output is truncated, the model sees an explicit notice — no silent data loss.

### Developer experience

The CLI ships a custom React-based TUI: fuzzy search and autocomplete with suggestion and correction for file paths, sessions, commands, and skills. A model picker queries provider APIs for available models. Tool output is structured with typed rendering. AST-based editing and scanning run through [ast-grep](https://ast-grep.github.io/).

---

For a detailed comparison with other open-source agents, see [Comparison](./comparison.md).

Measured code quality metrics are available in [Benchmarks](./benchmarks.md).

The background on why Acolyte was built is covered in [Meet Acolyte](https://crisu.me/blog/meet-acolyte).
