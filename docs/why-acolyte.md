# Why Acolyte?

> **TL;DR** Acolyte is an open-source, terminal-first AI coding agent built for reliable agent behavior: it trusts the model to make good decisions, runs automatic post-write effects, and preserves context across sessions. It runs as a headless daemon, supports any LLM provider, and gives you full control. A 4-phase lifecycle pipeline, post-write format/lint effects, context distillation, and real token budgeting built in. These are things most open-source agents don't have, and closed-source agents don't let you touch.

## Why open source?

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://openai.com/index/introducing-codex/) are excellent products. If you're happy with a single provider's CLI and don't need to customize agent behavior, they're the easiest path.

Open-source agents like Acolyte exist for the cases where that's not enough:

- **provider choice**: use OpenAI, Anthropic, Google, or any OpenAI-compatible endpoint — switch models per task without switching tools
- **self-hosted**: run everything on your own infrastructure with no data leaving your network
- **customizable agent behavior**: lifecycle phases, effects, and memory strategies are all configurable — not locked behind a closed product surface
- **transparent execution**: every tool call and effect decision is observable in structured logs — no black box
- **no vendor lock-in**: your sessions, memory, and configuration are local files you own

Acolyte is for developers who want reliable, observable agent behavior, not a black box. Ready to try it? See the [Quick Start](../README.md#quick-start).

## What makes Acolyte different

| Feature | What Acolyte does |
|---|---|
| Architecture | Headless daemon with typed RPC — CLI, editors, and custom clients share the same protocol |
| Lifecycle | 4-phase pipeline (resolve → prepare → generate → finalize) in separate, testable modules |
| Post-write effects | Automatic format and lint after writes; lint errors surface for the model to decide on |
| Memory | Context distillation extracts facts from conversations into 3-tier persistent storage |
| Context budgeting | Proactive token budgeting via tiktoken with system prompt reservation and priority-based allocation |
| Developer experience | Custom React TUI with fuzzy search, autocomplete, model picker, structured output, and AST-based editing |

### Daemon architecture

The server runs headless. CLI, editor plugins, and third-party clients all connect over the same typed RPC protocol. The TUI is just another client with no special access. Multiple clients can share a session, and integrations speak the protocol instead of forking the project.

### Lifecycle pipeline

Every request flows through five explicit phases, each in its own module with its own tests. The lifecycle trusts the model to make good decisions within a single generation pass. Format and lint effects run automatically after writes, and lint errors surface for the model to decide on. A step budget inlined into tool execution prevents runaway loops.

### Memory

Instead of compressing context under pressure, Acolyte proactively extracts structured facts (observations, reflections, and corrections) and commits them to persistent storage across three tiers: session, project, and user. The pipeline is explicit and each stage is strategy-injectable.

### Context budgeting

The system prompt is measured and reserved before history allocation begins. Remaining budget is filled by priority: pinned context → file attachments → history → tool payloads. Older tool outputs are progressively capped. When output is truncated, the model sees an explicit notice, not silent data loss.

### Developer experience

The CLI ships a custom React-based TUI: fuzzy search and autocomplete with suggestion and correction for file paths, sessions, commands, and skills. A model picker queries provider APIs for available models. Tool output is structured with typed rendering. AST-based editing and scanning run through [ast-grep](https://ast-grep.github.io/).

## Next steps

- [Architecture](./architecture.md) — How the system is built.
- [Comparison](./comparison.md) — How Acolyte compares to other open-source agents.
- [Benchmarks](./benchmarks.md) — Measured code quality metrics.
