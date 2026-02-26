# Architecture

## Overview

Acolyte is a CLI-first AI coding delegate built on Bun, Mastra, and Ink. The user interacts through a terminal chat UI that streams tool output in real time.

## Layers

```
CLI (Ink/React)
  └─ chat-submit-handler  (dispatch, file refs, slash commands)
       └─ Backend          (local mock or remote HTTP)
            └─ Server      (Bun HTTP, SSE streaming)
                 └─ Agent  (Mastra, tool execution)
```

### CLI (`cli.ts`, `chat-ui.tsx`)

Entry point. Loads config, initializes backend, renders the Ink TUI. Key components: `ChatTranscript` (message display with tool output), `ChatInputPanel` (autocomplete for `@path` and `/slash` commands).

### Submit handler (`chat-submit-handler.ts`)

Processes every user submission. Resolves slash commands, file references, memory directives, and permission checks before delegating to the assistant turn. Wires streaming events to UI row state.

### Backend (`backend.ts`)

Abstraction over local (mock) and remote (HTTP) backends. Defines `Backend` interface with `reply`, `replyStream`, `status`, and `setPermissionMode`. The remote backend parses SSE into typed `StreamEvent` values.

### Server (`server.ts`)

Bun HTTP server. Routes: `POST /v1/chat` (single response), `POST /v1/chat/stream` (SSE), `GET /healthz`. Passes `StreamEvent` from agent straight through as SSE — no normalization.

### Agent (`agent.ts`)

Thin wrapper around Mastra's `fullStream`. Forwards native chunk types (`text-delta`, `tool-call`, `tool-result`, `reasoning-delta`) as `StreamEvent`. Handles timeout recovery. Tool output from `mastra-tools.ts` is correlated with native IDs and emitted as `tool-output` events.

## Streaming pipeline

Native Mastra stream chunks flow through every layer without synthetic reconstruction:

```
Mastra fullStream
  → agent.ts (forward native chunks as StreamEvent)
    → server.ts (serialize to SSE, no dedup)
      → backend.ts (parse SSE back to StreamEvent)
        → chat-progress.ts (typed event router)
          → chat-submit-handler.ts (build UI rows)
```

### StreamEvent

```typescript
type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool-output"; toolCallId: string; toolName: string; content: string }
  | { type: "tool-result"; toolCallId: string; toolName: string; isError?: boolean }
  | { type: "status"; message: string }
  | { type: "error"; error: string }
```

## Tools (`mastra-tools.ts`, `coding-tools.ts`)

Ten tools registered with the Mastra agent: `read-file`, `edit-file`, `delete-file`, `run-command`, `find-files`, `search-files`, `git-status`, `git-diff`, `web-search`, `web-fetch`. Each emits content lines via `onToolOutput` during execution. Tool output is compacted to per-tool token budgets.

## Storage

- **Sessions**: `~/.acolyte/sessions.json` — chat history and token usage.
- **Saved memory**: `~/.acolyte/memory/user/` and `.acolyte/memory/project/` — markdown files injected into prompts.
- **Observational memory**: Mastra Memory (Postgres or in-memory) — learned patterns from conversation.

## Configuration (`app-config.ts`)

Merged from `.acolyte/config.toml` (project) and `~/.acolyte/config.toml` (user). Key settings: `model`, `port`, `apiUrl`, `permissionMode` (read/write), context token budgets.

## Key types

| Type | Location | Purpose |
|------|----------|---------|
| `StreamEvent` | `backend.ts` | Discriminated union for all stream events |
| `ChatRow` | `chat-commands.ts` | UI transcript row with role, content, style |
| `Backend` | `backend.ts` | Interface for local/remote backends |
| `Session` / `Message` | `types.ts` | Chat session and message persistence |
| `ChatRequest` / `ChatResponse` | `api.ts` | Wire format for backend communication |
