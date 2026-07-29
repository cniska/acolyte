# Observability

Acolyte records each request as an ordered, task-scoped event stream. The local trace lets you inspect what the runtime did after a turn instead of inferring it from prose.

## What a trace records

Every event carries a sequence number and is associated with its request, task, and session where available. The typed event catalog covers:

- task acceptance, queueing, start, completion, and state transitions
- workspace detection and sandbox resolution
- lifecycle preparation, generation, window drops, and errors
- tool calls, results, errors, and budget blocks
- format, lint, and install effects
- memory commits, active skill context, and the final lifecycle summary

The final summary includes model-call and tool-call counts, read/search/write totals, memory and session searches, pre-write discovery calls, budget exhaustion, and error state.

Memory commit events carry the shape of what was distilled: the message count and output size, and the task-activity digest's coverage — how many changed files, commands, and failures the turn contributed.

## Inspecting a task

`acolyte trace` lists recent tasks. `acolyte trace task <id>` renders the task's tool timeline and compact summary. Pass `--verbose` to include tool output events, or `--json` for one JSON line per event. `--verbose` shapes human output only; `--json` always carries every recorded event.

```bash
acolyte trace
acolyte trace task <id>
acolyte trace task <id> --verbose
acolyte trace task <id> --json
```

`--json` is the machine-readable surface for scripts and custom trace viewers. It returns stored event lines for a task rather than opening a streaming subscription.

## Local storage and failure behavior

Events are written to the daemon's logfmt log and SQLite-backed `trace.db`. The CLI queries the SQLite store for indexed task lookups, so the trace stays local and does not depend on provider telemetry or an external tracing service.

Tracing is diagnostic, not part of the request's success path. If the trace store cannot open or write, Acolyte warns once for that session and continues the task.

## Telemetry

Acolyte has no product telemetry client. Trace events remain in local logs and `trace.db`; the trace system does not upload them.

## Key files

- `src/trace-event-catalog.ts` — event names and display fields
- `src/trace-store.ts` — SQLite-backed trace storage and queries
- `src/cli-trace.ts` — task timeline rendering in the CLI
- `src/server-chat-runtime.ts` — log and trace-store writes

## Further reading

- [CLI](./cli.md) — trace command reference
- [Tasks](./tasks.md) — tracked request execution and state transitions
- [Lifecycle](./lifecycle.md) — phase boundaries, effects, and final summaries
