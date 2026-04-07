# Features

Shipped, user-visible capabilities.

## CLI

- interactive chat and one-shot run/skill commands
- persistent daemon with automatic startup and lifecycle management
- session resume and history
- model picker that queries provider APIs for available models
- fuzzy search and autocomplete for file paths, sessions, commands, and skills
- file and directory attachments via @path
- slash commands and skill invocation
- engineering skills for structured workflows (plan, build, review, ship)
- configurable locale
- multi-line input
- custom terminal renderer with React reconciler and structured output
- auto-update on startup with progress UI
- update flags to force or skip auto-update (--update, --no-update)
- one-line install script

## Agent execution

- single-pass lifecycle with resolve/prepare/generate/finalize phases
- explicit completion signals (done, no-op, blocked)
- pre/post-tool-call effect pipeline (auto-install deps, format, lint)
- workspace profile detection with auto-detected install, lint, format, and test commands
- configurable model reasoning level (low, medium, high) with provider-specific mapping
- multi-provider support (OpenAI, Anthropic, Google, Vercel)
- provider rate limit awareness with sliding window pacing and exponential backoff
- proactive token budgeting with system prompt reservation and priority-based allocation
- step budget enforcement for cost protection
- two-tier result cache for read-only and search tools with cross-task persistence
- streaming progress output with real-time token usage
- inline task checklist for multi-step tasks

## Tools

- find/search/read files with gitignore awareness
- edit/create/delete files
- AST-based structural code editing with workspace-wide scope
- git status/diff/log/show/add/commit
- shell and test execution
- web search/fetch

## Memory

- on-demand memory toolkit (search, add, remove)
- three-scope persistent memory (session, project, user)
- automatic observation via distiller with @observe directives
- semantic recall with embeddings and cosine similarity ranking

## Safety and control

- workspace sandbox boundary enforcement for filesystem access
- cooperative interruption and queued message handling

## Diagnostics

- lifecycle trace with SQLite-backed indexed queries
- structured logs with level, session, and time filtering
- token usage reporting with prompt breakdown per turn
- status command with JSON output
- scoped debug logging with wildcard tag matching
