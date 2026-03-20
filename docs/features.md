# Features

Shipped, user-visible capabilities.

## CLI

- interactive chat
- one-shot run mode with `--model` and `--file` flags
- one-shot skill execution via `acolyte skill <name> <prompt>` with `--model` flag
- session resume and session listing
- configurable locale via `config set locale <tag>`
- fuzzy search and autocomplete with suggestion and correction for file paths, sessions, commands, and skills
- model picker that queries provider APIs for available models, with per-mode selection (`/model work|verify <id>`)
- automatic server startup/reuse for chat and run mode
- server control commands (`start`, `stop`, `restart`, `ps`, `status`)
- status guidance when daemon server is not running
- managed vs unmanaged server state visibility in CLI status/stop flows
- managed server replacement when daemon target changes
- `@path` file/directory attachments
- slash command support
- skill invocation via slash commands
- HTTP and RPC transport support
- custom terminal renderer with React reconciler, static/active split, and structured output

## Agent execution

- lifecycle-driven execution with work/verify behavior
- explicit lifecycle completion signals so the agent can stop cleanly when work is done or no changes are needed
- automatic verify pass after write operations
- task-scoped verify boundaries by default, with opt-in global verify scope
- tool-guarded execution for safer autonomous runs
- streaming progress output for tool activity with real-time token usage
- proactive token budgeting via tiktoken with system prompt reservation and priority-based allocation
- two-tier result cache for read-only and search tools with SQLite-backed cross-task persistence

## Tools

- find/search/read files
- edit/create/delete files
- scan/edit code via AST-based tools
- git status/diff/log/show/add/commit
- shell command execution
- web search/fetch
- file discovery respects `.gitignore` (including nested)

## Memory

- user-scoped saved memory
- project-scoped saved memory
- memory inspect/list/remove commands
- context distillation with automatic observation and reflection
- session-scoped distill memory
- SQLite-backed persistent storage for distill records
- semantic recall with provider embeddings and cosine similarity ranking

## Safety and control

- read/write permission modes
- workspace and temp-root path guardrails
- write confirmation flow in read mode
- cooperative interruption and queued message handling over RPC

## Diagnostics

- status command with `--json` output
- token usage reporting per turn with prompt breakdown (system, tools, memory, messages) and share percentages
- lifecycle trace command with SQLite-backed indexed queries (`acolyte trace`)
- managed daemon log file at `~/.acolyte/daemons/server.log`
- configurable log format (`logfmt` or `json`) via `logFormat` config key
- scoped debug logging via `ACOLYTE_DEBUG` tags (supports wildcard matching)
- status output resource diagnostics for prompt/skill/config load problems
