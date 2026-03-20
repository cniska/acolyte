# Roadmap

## Vision

One terminal-first AI coding agent for day-to-day development across projects and machines.
Opinionated for the 80% default workflow, with stable extension points for customization.
Built for safe autonomous execution of bounded tasks with the developer in control.

## Shipped

- 5-phase lifecycle with streaming tool calls, guards, and automatic verify cycles
- Context distillation with 3-tier persistent memory (session/project/user)
- Semantic recall with provider embeddings and cosine similarity ranking
- SQLite-backed storage for distill records, embeddings, and lifecycle traces
- AST-aware structural editing via ast-grep
- Custom React terminal renderer with single input pipeline
- Typed RPC protocol with task state machine
- Lifecycle observability via `acolyte trace`
- Skills system with declarative SKILL.md standard
- Multi-provider support (OpenAI, Anthropic, Google)

## What's next

Tracked in [GitHub Issues](https://github.com/cniska/acolyte/issues). Key priorities:

- **Structured log format** — JSON log output for daemon (#34)
- **Logs command** — CLI access to daemon logs (#32)
- **Tool cache persistence** — SQLite-backed cross-task tool cache (#38)
- **Trace event subscription** — real-time trace events over RPC (#45)
- **Plan mode** — lifecycle-driven planning phase with read-only tool set (#14)
- **Required-input handoff** — structured model-to-user handoff for decisions (#17)
