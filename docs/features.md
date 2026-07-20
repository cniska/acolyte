# Features

Acolyte combines a terminal-first client, headless daemon, lifecycle effects, persistent memory, and typed tools in one open-source coding agent.

## CLI

- interactive chat and one-shot `run`/`skill` commands
- persistent daemon with automatic startup and lifecycle management
- session resume by ID prefix with history
- model picker that queries provider APIs for available models
- fuzzy search and autocomplete for file paths, sessions, commands, and skills
- file and directory attachments via `@path`
- slash commands and skill invocation
- engineering skills for structured workflows (plan, build, review, ship)
- an always-available skill roster the agent activates on demand
- configurable locale
- multi-line input
- custom terminal renderer with React reconciler and structured output
- live status line with location, model, token, skill, and PR segments
- auto-update on startup with progress UI
- update flags to force or skip auto-update (`--update`, `--no-update`)
- XDG Base Directory support on Linux
- one-line install script

## Agent execution

- single-pass lifecycle with `resolve`/`prepare`/`generate`/`finalize` phases
- native `end_turn` completion (turn ends on a step with no tool calls)
- pre/post-tool-call effect pipeline (auto-install deps, format, lint)
- Workspace profile detection with auto-detected install, lint, format, and test commands
- Configurable model reasoning level (low, medium, high) with provider-specific mapping
- Multi-provider support (OpenAI, Anthropic, Google, Vercel)
- OpenAI subscription auth via `acolyte auth openai` (browser OAuth), instead of an API key
- `acolyte init [provider]` stores a provider API key globally, reused across every repository
- Provider rate limit awareness with sliding window pacing and exponential backoff
- Provider prompt-cache awareness with cached input token reporting
- Proactive token budgeting with system prompt reservation and priority-based allocation
- Step budget enforcement for cost protection
- Two-tier result cache for read-only and search tools with cross-task persistence
- Streaming progress output with real-time token usage
- Inline task checklist for multi-step tasks

## Tools

- find/search/read files with gitignore awareness
- edit/create/delete files
- AST-based structural code editing
- git status/diff/log/show/add/commit
- GitHub CLI integration for PR and issue management (view/create/edit), auto-enabled when `gh` is installed
- on-demand session search across conversation history
- shell and test execution
- web search/fetch
- MCP client: connect to external services via stdio or HTTP MCP servers

## Memory

- on-demand memory toolkit (`memory-search`, `memory-add`, `memory-remove`)
- three-scope persistent memory (session, project, user)
- memory recalled on-demand via tools (not injected into the system prompt)
- automatic observation via distiller (tool-based, runs after generation)
- self-bootstrap project memory from codebase on first run
- Semantic recall with embeddings and cosine similarity ranking
- Hybrid retrieval scoring (cosine similarity + TF-IDF token overlap) with search result re-ranking
- Topic tags on observations for filtered recall

## Safety and control

- workspace sandbox boundary enforcement for filesystem access
- cooperative interruption and queued message handling

## Diagnostics

- lifecycle trace with SQLite-backed indexed queries
- structured logs with level, session, and time filtering
- token usage reporting with prompt and prompt-cache breakdown per turn
- status command with JSON output
- scoped debug logging with wildcard tag matching

## Feature-flagged

Implemented but gated behind feature flags. See [Configuration](configuration.md) for setup.

- `syncAgents` — sync `AGENTS.md` into project memory for on-demand recall
- `undoCheckpoints` — session-level undo via write-tool checkpoints
- `parallelWorkspaces` — manage git worktrees and workspace-scoped sessions via `/workspaces`
- `cloudSync` — portable memory and sessions across machines via `acolyte login` and `acolyte logout`
- Postgres session storage backend and Postgres + pgvector memory backend (used by cloud tier)
