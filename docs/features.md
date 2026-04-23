# Features

Shipped, user-visible capabilities.

## CLI

- interactive chat and one-shot `run`/`skill` commands
- persistent daemon with automatic startup and lifecycle management
- session resume by ID prefix with history
- model picker that queries provider APIs for available models
- fuzzy search and autocomplete for file paths, sessions, commands, and skills
- file and directory attachments via `@path`
- slash commands and skill invocation
- engineering skills for structured workflows (plan, build, review, ship)
- keyword-based skill suggestions from user prompts
- configurable locale
- multi-line input
- custom terminal renderer with React reconciler and structured output
- auto-update on startup with progress UI
- update flags to force or skip auto-update (`--update`, `--no-update`)
- XDG Base Directory support on Linux
- one-line install script

## Agent execution

- single-pass lifecycle with `resolve`/`prepare`/`generate`/`finalize` phases
- explicit completion signals (`done`, `no_op`, `blocked`)
- pre/post-tool-call effect pipeline (auto-install deps, format, lint)
- Workspace profile detection with auto-detected install, lint, format, and test commands
- Configurable model reasoning level (low, medium, high) with provider-specific mapping
- Multi-provider support (OpenAI, Anthropic, Google, Vercel)
- Provider rate limit awareness with sliding window pacing and exponential backoff
- Proactive token budgeting with system prompt reservation and priority-based allocation
- Step budget enforcement for cost protection
- Two-tier result cache for read-only and search tools with cross-task persistence
- Streaming progress output with real-time token usage
- Inline task checklist for multi-step tasks

## Tools

- find/search/read files with gitignore awareness
- edit/create/delete files
- AST-based structural code editing with workspace-wide scope
- git status/diff/log/show/add/commit
- GitHub CLI integration for PR and issue management (view/create/edit), auto-enabled when `gh` is installed
- shell and test execution
- web search/fetch
- MCP client: connect to external services via stdio or HTTP MCP servers

## Memory

- on-demand memory toolkit (`memory-search`, `memory-add`, `memory-remove`)
- three-scope persistent memory (session, project, user)
- memory recalled on-demand via tools (not injected into the system prompt)
- automatic observation via distiller with `@observe` directives
- Semantic recall with embeddings and cosine similarity ranking
- Hybrid retrieval scoring (cosine similarity + TF-IDF token overlap)
- Topic tags on observations for filtered recall

## Safety and control

- workspace sandbox boundary enforcement for filesystem access
- cooperative interruption and queued message handling

## Diagnostics

- lifecycle trace with SQLite-backed indexed queries
- structured logs with level, session, and time filtering
- token usage reporting with prompt breakdown per turn
- status command with JSON output
- scoped debug logging with wildcard tag matching

## Feature-flagged

Implemented but gated behind feature flags. See [Configuration](configuration.md) for setup.

- `syncAgents` — sync `AGENTS.md` into project memory for on-demand recall
- `undoCheckpoints` — session-level undo via write-tool checkpoints
- `parallelWorkspaces` — manage git worktrees and workspace-scoped sessions via `/workspaces`
- `cloudSync` — portable memory and sessions across machines via `acolyte login` and `acolyte logout`
