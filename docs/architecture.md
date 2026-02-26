# Architecture

## Layers

```
CLI (Ink/React)
  └─ chat-submit-handler
       └─ Client (HTTP + SSE)
            └─ Server (Bun HTTP)
                 └─ Agent (Mastra)
```

**CLI** (`cli.ts`, `chat-ui.tsx`) — Ink TUI with streaming tool output, `@path` autocomplete, `/slash` commands.

**Submit handler** (`chat-submit-handler.ts`) — resolves slash commands, file references, memory directives, and permission checks before delegating to the client.

**Client** (`client.ts`) — HTTP client that parses SSE into typed `StreamEvent` values.

**Server** (`server.ts`) — Bun HTTP. Routes: `POST /v1/chat`, `POST /v1/chat/stream` (SSE), `GET /healthz`. Passes `StreamEvent` from agent through as SSE.

**Agent** (`agent.ts`) — wraps Mastra's `fullStream`. Classifies task mode upfront, builds mode-specific instructions, forwards native chunks as `StreamEvent`. Handles plan detection and timeout recovery.

## Agent modes (`agent-modes.ts`)

Three modes with distinct tool sets and instructions:

| Mode | Tools | Trigger |
|------|-------|---------|
| `explore` | find-files, search-files, read-file, git-status, git-diff, web-search, web-fetch | Read-only keywords |
| `code` | edit-code, edit-file, create-file, delete-file, run-command | Action keywords |
| `ask` | (none) | Fallback |

`classifyMode(message)` picks the initial mode via keyword heuristics. Mode can switch mid-run when the model calls a tool from a different mode. Mode instructions are generated dynamically from `toolMeta` in `mastra-tools.ts`.

## Tools (`mastra-tools.ts`, `agent-tools.ts`)

12 tools registered with Mastra. Each tool has a `ToolMeta` entry with an `instruction` (used to build mode-specific system instructions) and `aliases` (used by `canonicalToolId` to normalize model output). Tool output is compacted to per-tool token budgets.

## Streaming pipeline

```
Mastra fullStream
  → agent.ts (forward native chunks as StreamEvent)
    → server.ts (serialize to SSE)
      → client.ts (parse SSE to StreamEvent)
        → chat-progress.ts (typed event router)
          → chat-submit-handler.ts (build UI rows)
```

## Storage

- **Sessions**: `~/.acolyte/sessions.json`
- **Saved memory**: `~/.acolyte/memory/user/` and `.acolyte/memory/project/`
- **Observational memory**: Mastra Memory (Postgres)

## Configuration (`app-config.ts`)

Merged from `.acolyte/config.toml` (project) and `~/.acolyte/config.toml` (user). Key settings: `model`, `port`, `apiUrl`, `permissionMode` (read/write), context token budgets.
