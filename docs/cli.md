# CLI

The Acolyte CLI provides interactive chat, one-shot runs, session and memory management, configuration, tracing, direct tools, and server control.

## Commands

- `acolyte` — start interactive chat
- `acolyte auth [provider]` — authenticate a provider (API key or subscription); `--key`, `--subscription`, `--logout`
- `acolyte login` — authenticate with the cloud (feature-flagged: `features.cloudSync`)
- `acolyte logout` — remove cloud credentials (feature-flagged: `features.cloudSync`)
- `acolyte resume [id]` — continue a previous session
- `acolyte run "<prompt>"` — one-shot execution
- `acolyte run --file <path> "<prompt>"` — one-shot with file context
- `acolyte history` — list sessions
- `acolyte start|stop|restart|ps` — manage server lifecycle
- `acolyte stop|restart --force` — stop even while a turn is running, abandoning it
- `acolyte status` — show server status
- `acolyte memory list|add|restore` — manage memory and its archive
- `acolyte config list|set|unset` — manage configuration
- `acolyte skill <name> [prompt]` — run a prompt with an active skill
- `acolyte logs` — view server logs
- `acolyte tool <tool-id> ['<json-input>']` — run a tool directly, passing its input as one JSON object
- `acolyte trace list|task <id>` — inspect server lifecycle traces
- `acolyte update` — update to latest version

Run `acolyte <command> help` for detailed usage.

All list commands support `--json` for machine-readable output. A `--json` run prints only its data on stdout — logs and errors go to stderr, and informational messages such as an empty result are omitted, so an empty result is an empty stream. `acolyte status --json` exits non-zero when the server is stopped.

## Local models

See [Configuration](./configuration.md) for OpenAI-compatible model setup.

## Provider auth

Authenticate providers with an API key or, where supported, a subscription. This is separate from `acolyte login`, which authenticates the cloud sync service.

```bash
acolyte auth                         # pick a provider from the list, then how to authenticate
acolyte auth openai                  # pick key or subscription from the list
acolyte auth openai --key            # store OPENAI_API_KEY
acolyte auth openai --subscription   # browser OAuth (port 1455)
acolyte auth vercel --key            # store AI_GATEWAY_API_KEY
acolyte auth openai --logout         # remove stored key and subscription for openai
acolyte auth openai --logout --key   # remove only the stored API key
acolyte auth openai --logout --subscription # remove only the subscription
```

See [Configuration](./configuration.md) for how a subscription interacts with an API key.

## Memory commands

Manage saved memory notes scoped to user or project.

```bash
acolyte memory list [all|user|project]
acolyte memory list --json
acolyte memory add --user "<text>"
acolyte memory add --project "<text>"
acolyte memory restore <id>...
```

## Config commands

Read and write runtime configuration at user or project level. Nested config uses dotted keys, such as `features.mcp`.

```bash
acolyte config list [--project]
acolyte config list --json
acolyte config set <key> <value>
acolyte config set --project <key> <value>
acolyte config set --project features.mcp true
acolyte config unset <key>
```

See [Configuration](./configuration.md) for available keys.

## Logs commands

Tail and filter the daemon server log.

```bash
acolyte logs                              # tail latest lines
acolyte logs -n 100                       # tail N lines
acolyte logs --level warn                 # filter by level
acolyte logs --session <id>               # filter by session
acolyte logs --since 5m                   # lines from last N minutes
acolyte logs --level error --since 1h     # combine filters
acolyte logs --json                       # JSON-lines output
```

## Trace commands

Inspect lifecycle execution traces stored in SQLite.

```bash
acolyte trace                    # list recent tasks
acolyte trace list               # same as above
acolyte trace task <id>          # inspect a task's lifecycle trace
acolyte trace task <id> --json   # output as JSON lines
acolyte trace --lines 100        # show last 100 tasks
```

Narrow a task's timeline with either filter, or both together:

```bash
acolyte trace task <id> --event lifecycle.model_usage        # keep one event
acolyte trace task <id> --event lifecycle.error,lifecycle.window.drop
acolyte trace task <id> --tool shell-exec                    # one tool, calls and results
acolyte trace task <id> --event lifecycle.tool.result --tool file-read
```

An `--event` name must come from the trace event catalog; an unknown name is refused. A filter renders one row per event rather than the paired call/result timeline, and applies to `--json` as well. Filters take a task, not the task list.

## Output and color

Human output is colored only when stdout is a terminal, so redirecting or piping any command yields plain text. `NO_COLOR` in the environment turns color off for a terminal too.
