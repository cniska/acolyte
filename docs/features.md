# Features

Shipped, user-visible capabilities.

## CLI

- Interactive chat.
- One-shot run mode with `--model` and `--file` flags.
- One-shot skill execution via `acolyte skill <name> <prompt>` with `--model` flag.
- Session resume and session listing.
- Configurable locale via `config set locale <tag>`.
- Fuzzy search and autocomplete with suggestion and correction for file paths, sessions, commands, and skills.
- Model picker that queries provider APIs for available models, with per-mode selection (`/model work|verify <id>`).
- Automatic server startup/reuse for chat and run mode.
- Server control commands (`start`, `stop`, `restart`, `ps`, `status`).
- Status guidance when daemon server is not running.
- Managed vs unmanaged server state visibility in CLI status/stop flows.
- Managed server replacement when daemon target changes.
- `@path` file/directory attachments.
- Slash command support.
- Skill invocation via slash commands.
- HTTP and RPC transport support.
- Custom terminal renderer with React reconciler, static/active split, and structured output.

## Agent execution

- Lifecycle-driven execution with work/verify behavior.
- Explicit lifecycle completion signals so the agent can stop cleanly when work is done or no changes are needed.
- Automatic verify pass after write operations.
- Task-scoped verify boundaries by default, with opt-in global verify scope.
- Tool-guarded execution for safer autonomous runs.
- Streaming progress output for tool activity with real-time token usage.
- Proactive token budgeting via tiktoken with system prompt reservation and priority-based allocation.
- Per-task LRU result cache for read-only and search tools.

## Tools

- Find/search/read files.
- Edit/create/delete files.
- Structural code scanning and editing via dedicated `scan-code` and `edit-code` tools.
- Git status/diff.
- Shell command execution.
- Web search/fetch.
- File discovery respects `.gitignore` and nested `.gitignore` files.

## Memory

- User-scoped saved memory.
- Project-scoped saved memory.
- Memory inspect/list/remove commands.
- Context distillation with automatic observation and reflection.
- Session-scoped distill memory.
- SQLite-backed persistent storage for distill records.
- Semantic recall with provider embeddings and cosine similarity ranking.

## Safety and control

- Read/write permission modes.
- Workspace and temp-root path guardrails.
- Write confirmation flow in read mode.
- Cooperative interruption and queued message handling over RPC.

## Diagnostics

- Status command with `--json` output.
- Token usage reporting per turn with prompt breakdown (system, tools, memory, messages) and share percentages.
- Lifecycle trace command with SQLite-backed indexed queries (`acolyte trace`).
- Managed daemon log file at `~/.acolyte/daemons/server.log`.
- Scoped debug logging via `ACOLYTE_DEBUG` tags (supports wildcard matching).
- Status output resource diagnostics for prompt/skill/config load problems.
