# Architecture

## Mental model (ELI5)

Think of Acolyte as a careful helper with a checklist:

1. Understand the task.
2. Gather what it needs.
3. Do the work with tools.
4. Check the result.
5. Finish with an answer.

While it works, it leaves numbered breadcrumbs (events) so we can replay what happened in order.
If it starts repeating the same action too many times, safety rules stop the loop and push it to change strategy.

## Layers

```
CLI → Submit handler → Client → Server → Lifecycle → Agent → Tools
```

| Layer | Key files | Role |
|-------|-----------|------|
| CLI | `cli.ts`, `chat-ui.tsx` | Ink TUI, `@path` autocomplete, `/slash` commands |
| Submit handler | `chat-submit-handler.ts` | Slash commands, file refs, memory, permissions |
| Client | `client.ts` | HTTP + SSE → typed `StreamEvent` |
| Server | `server.ts` | Bun HTTP, routes: `/v1/status`, `/v1/chat`, `/v1/chat/stream` (+ OM admin endpoints) |
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

**Evaluators** run after generation in order. Each inspects `RunContext` and returns `done` or `regenerate`. The runner continues through all evaluators (with caps) so multiple evaluators can chain controlled regenerations.

| Evaluator | Trigger | Action |
|-----------|---------|--------|
| `planDetector` | Output is plan-like, no tools used | Re-invoke with execution nudge |
| `multiMatchEditEvaluator` | `edit-file` multi-match error seen, no `edit-code` used yet | Regenerate with explicit `edit-code` next-step guidance (file-scoped path) |
| `efficiencyEvaluator` | Work-mode write intent + excessive pre-write discovery | Regenerate with "edit now, verify after" guidance |
| `autoVerifier` | Work mode, write tools used, no verify ran | Run verify mode (`keepResult` preserves work output) |

New post-generation behavior = implement `Evaluator`, add to array.

Regeneration limits:
- Request cap: `MAX_REGENERATIONS_PER_REQUEST` (currently `3`)
- Per-evaluator cap: `MAX_REGENERATIONS_PER_EVALUATOR` (currently `1`)

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
| `excessiveFileLoopGuard` | Blocks repeated same-file read/edit churn and forces strategy change |
| `verifyRanGuard` | Sets `verifyRan` flag on verify commands |

## Lifecycle Observability

Lifecycle debug events are emitted as a typed envelope (`LifecycleDebugEvent`) and logged by the server.

Envelope fields:
- `event`: lifecycle event id (for example `lifecycle.tool.call`)
- `sequence`: per-request monotonic event number
- `phaseAttempt`: generation attempt number (initial run + regenerations)
- `ts`: event timestamp
- `fields`: event-specific payload (tool, path, duration, evaluator decision, summary counters, etc.)

Useful tooling:
- `bun run trace:lifecycle` (compact trace for latest request)
- `bun run trace:lifecycle -- --request err_...` (specific request id)

## Storage

- **Sessions**: `~/.acolyte/sessions.json`
- **Saved memory**: `~/.acolyte/memory/user/` and `.acolyte/memory/project/`
- **Observational memory**: Mastra Memory (Postgres)

## Configuration (`app-config.ts`)

Merged from `.acolyte/config.toml` (project) and `~/.acolyte/config.toml` (user). Key settings: `model`, `models` (per-mode overrides), `port`, `apiUrl`, `permissionMode`, context token budgets.
