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
- Lifecycle observability via `acolyte trace` with SQLite-backed indexed queries
- Structured JSON log format with configurable `logFormat`
- CLI access to daemon logs via `acolyte logs`
- Skills system with declarative SKILL.md standard
- Multi-provider support (OpenAI, Anthropic, Google)
- SQLite-backed cross-task tool cache
- Structured model-to-user handoff for blocked signals (`awaiting-input` state)
- Workspace profile detection for ecosystem, lint, format, verify, package manager, and line width
- Deterministic format → lint → verify evaluator chain from detected workspace commands
- Pluggable ecosystem detectors for TypeScript, Python, Go, Rust

## What's next

Tracked in [GitHub Issues](https://github.com/cniska/acolyte/issues). Key priorities:

- **Plan mode** — lifecycle-driven planning phase with approval workflow (#14)
- **Inline task checklist** — real-time progress display for multi-step tasks (#49)
- **Trace event subscription** — real-time trace events over RPC (#45)
