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
- engineering skills for structured workflows (plan, build, review)
- an always-available skill roster the agent activates and deactivates on demand
- project and user skills from `.agents/skills`
- Agent Plugins from `.agents/plugins`, contributing skills and MCP servers
- translated interface, selected by locale
- multi-line input
- custom terminal renderer with React reconciler and structured output
- syntax highlighting for fenced code and edit diffs
- live status line with location, model, token, skill, and PR segments
- auto-update on startup with progress UI
- update flags to force or skip auto-update (`--update`, `--no-update`)
- XDG-style global directories
- one-line install script

## Agent execution

- single-pass lifecycle with `resolve`/`prepare`/`generate`/`finalize` phases
- native `end_turn` completion (turn ends on a step with no tool calls)
- pre/post-tool-call effect pipeline (auto-install deps, format, lint)
- workspace profile detection with auto-detected install, lint, format, and test commands
- configurable model reasoning level (low, medium, high) with provider-specific mapping
- multi-provider support (OpenAI, Anthropic, Google, Vercel)
- unified provider auth via `acolyte auth` — API key or subscription (OpenAI OAuth), global credentials, status and logout
- provider rate limit awareness with sliding window pacing and exponential backoff
- provider prompt-cache awareness with cached input token reporting
- proactive token budgeting with system prompt reservation and priority-based allocation
- step budget enforcement for cost protection
- streaming progress output with real-time token usage
- inline tasklist for multi-step tasks

## Tools

- find/search/read files with gitignore awareness; reads return the whole file, with an explicit line range for files over the token ceiling
- edit/create/delete files
- AST-based structural code editing
- git status/diff/log/show/add/commit
- GitHub CLI integration for PR and issue management (view/create/edit), auto-enabled when `gh` is installed
- on-demand session search across conversation history
- shell and test execution, with command output streaming into the transcript while it runs
- web search/fetch
- MCP client: connect to external services via stdio or HTTP MCP servers

## Memory

- three-scope persistent memory (session, project, user)
- automatic observation via distiller (tool-based, runs after generation)
- self-bootstrap project memory from codebase on first run
- topic tags on observations for filtered recall
- on-demand memory toolkit (`memory-search`, `memory-add`)
- memory recalled on-demand via tools (not injected into the system prompt)
- semantic recall with embeddings and cosine similarity ranking
- hybrid retrieval scoring (cosine similarity + TF-IDF token overlap) with search result re-ranking
- archive and restore retired memory with supersession lineage

## Safety and control

- workspace sandbox boundary enforcement for filesystem access
- cooperative interruption and queued message handling
- `acolyte stop` and `restart` refuse while work is unfinished, naming it; `--force` overrides

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
- `workspaces` — manage git worktrees and workspace-scoped sessions via `/workspaces`
- `cloudSync` — portable memory and sessions across machines via `acolyte login` and `acolyte logout`
- Postgres session storage backend and Postgres + pgvector memory backend (used by cloud tier)
