# Features

Short inventory of shipped, user-visible capabilities.

Update rule:
- Add only when a feature is actually shipped.
- Keep each item one line.
- Prefer stable capability names over implementation details.

## CLI

- Interactive chat mode.
- One-shot run mode.
- Session resume and session listing.
- Automatic local server startup/reuse for chat and run mode (local-default config).
- Local server control commands (`server start`, `server status`, `server stop`).
- Local-first status guidance when daemon server is not running.
- Managed vs unmanaged local server state visibility in CLI status/stop flows.
- Managed local server replacement when local daemon target changes.
- `@path` file/directory attachments.
- Slash command support.
- Skill invocation via slash commands.
- HTTP and RPC transport support.

## Agent Execution

- Lifecycle-driven execution with plan/work/verify behavior.
- Automatic verify pass after write operations.
- Task-scoped verify boundaries by default, with opt-in global verify scope.
- Tool-guarded execution for safer autonomous runs.
- Streaming progress output for tool activity.

## Tools

- Find/search/read files.
- Edit/create/delete files.
- AST scan and AST edit.
- Git status/diff.
- Shell command execution.
- Web search/fetch.

## Memory

- User-scoped saved memory.
- Project-scoped saved memory.
- Memory inspect/list/remove commands.

## Safety and Control

- Read/write permission modes.
- Workspace and temp-root path guardrails.
- Write confirmation flow in read mode.
- Cooperative interruption and queued message handling over RPC.

## Diagnostics

- Status command.
- Token usage reporting.
- Lifecycle trace logging (auto-picks daemon or legacy log path).
- Managed local daemon log file at `~/.acolyte/server.log`.
