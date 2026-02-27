# Architecture

## Layers

```
CLI → Submit handler → Client → Server → Lifecycle → Agent → Tools
```

| Layer | Key files | Role |
|-------|-----------|------|
| CLI | `cli.ts`, `chat-ui.tsx` | Ink TUI, `@path` autocomplete, `/slash` commands |
| Submit handler | `chat-submit-handler.ts` | Slash commands, file refs, memory, permissions |
| Client | `client.ts` | HTTP + SSE → typed `StreamEvent` |
| Server | `server.ts` | Bun HTTP, routes: `/v1/chat`, `/v1/chat/stream`, `/healthz` |
| Lifecycle | `agent-lifecycle.ts` | Request phases + evaluator loop (see below) |
| Agent | `agent.ts`, `agent-factory.ts` | `runAgent()` → lifecycle, input/output helpers |
| Tools | `mastra-tools.ts`, `agent-tools.ts` | 13 tools with guards, aliases, token budgets |

## Lifecycle (`agent-lifecycle.ts`)

Three nested levels:

```
Request:    classify → prepare → generate → evaluate → finalize
Generation: model-call → [stream → tool-call → tool-result]* → done
Tool:       validate (guards) → execute → record (session)
```

`classify` and `prepare` return values used to construct `RunContext` — no uninitialized fields. `generate` and `finalize` operate on the mutable context.

**Evaluators** run after generation. Each inspects `RunContext` and returns `done` or `regenerate`. The runner loops until all return done.

| Evaluator | Trigger | Action |
|-----------|---------|--------|
| `planDetector` | Output is plan-like, no tools used | Re-invoke with execution nudge |
| `autoVerifier` | Work mode, write tools used, no verify ran | Run verify mode (`keepResult` preserves work output) |

New post-generation behavior = implement `Evaluator`, add to array.

## Modes (`agent-modes.ts`)

| Mode | Tools | Trigger |
|------|-------|---------|
| `plan` | find-files, search-files, read-file, scan-code, git-status, git-diff, web-search, web-fetch | Read-only keywords (default) |
| `work` | edit-code, edit-file, create-file, delete-file, run-command | Action keywords |
| `verify` | run-command, read-file, search-files, edit-code, scan-code, edit-file, create-file | `autoVerifier` evaluator |

`classifyMode()` picks the initial mode. Mode switches mid-run when the model calls a tool from a different mode (locked during verify). Instructions built dynamically from `toolMeta`.

## Tool guards (`tool-guards.ts`)

Every tool call passes through `guardedExecute`: run guards → execute → record call.

`SessionContext` holds per-request state: `callLog`, `flags`, `onGuard` callback.

| Guard | Action |
|-------|--------|
| `noRewriteGuard` | Blocks delete-file on previously-read paths |
| `verifyRanGuard` | Sets `verifyRan` flag on verify commands |

## Storage

- **Sessions**: `~/.acolyte/sessions.json`
- **Saved memory**: `~/.acolyte/memory/user/` and `.acolyte/memory/project/`
- **Observational memory**: Mastra Memory (Postgres)

## Configuration (`app-config.ts`)

Merged from `.acolyte/config.toml` (project) and `~/.acolyte/config.toml` (user). Key settings: `model`, `models` (per-mode overrides), `port`, `apiUrl`, `permissionMode`, context token budgets.
