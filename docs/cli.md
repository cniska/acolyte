# CLI

The Acolyte CLI provides interactive chat, one-shot runs, session and memory management, configuration, tracing, direct tools, and server control.

## Commands

- `acolyte`: start interactive chat
- `acolyte init [provider]`: initialize provider API key
- `acolyte auth [provider]`: authenticate a provider with a subscription; `--logout` to disconnect
- `acolyte login`: authenticate with the cloud (feature-flagged: `features.cloudSync`)
- `acolyte logout`: remove cloud credentials (feature-flagged: `features.cloudSync`)
- `acolyte resume [id]`: continue a previous session
- `acolyte run "<prompt>"`: one-shot execution
- `acolyte run --file <path> "<prompt>"`: one-shot with file context
- `acolyte history`: list sessions
- `acolyte start|stop|restart|ps`: manage server lifecycle
- `acolyte status`: show server status
- `acolyte memory list|add`: manage memory
- `acolyte config list|set|unset`: manage configuration
- `acolyte skill <name> [prompt]`: run a prompt with an active skill
- `acolyte logs`: view server logs
- `acolyte tool <tool-id> [args...]`: run a tool directly
- `acolyte trace list|task <id>`: inspect server lifecycle traces
- `acolyte update`: update to latest version

Run `acolyte <command> help` for detailed usage.

All list commands support `--json` for machine-readable output.

## Local models

See [Configuration](./configuration.md) for OpenAI-compatible model setup.

## Subscription auth

Authenticate OpenAI with an OpenAI subscription instead of an API key. This is separate from `acolyte login`, which authenticates the cloud sync service.

```bash
acolyte auth openai            # browser OAuth on a loopback callback (port 1455)
acolyte auth                   # show which providers are connected
acolyte auth openai --logout   # disconnect the subscription
```

See [Configuration](./configuration.md) for how a subscription interacts with an API key.

## Memory commands

Manage saved memory notes scoped to user or project.

```bash
acolyte memory list [all|user|project]
acolyte memory list --json
acolyte memory add --user "<text>"
acolyte memory add --project "<text>"
```

## Config commands

Read and write runtime configuration at user or project level.

```bash
acolyte config list [--project]
acolyte config list --json
acolyte config set <key> <value>
acolyte config set --project <key> <value>
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
