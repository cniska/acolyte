# CLI

The CLI is the primary interface for working with Acolyte.

## Commands

- `acolyte`: start interactive chat
- `acolyte init [provider]`: initialize provider API key
- `acolyte resume [id]`: continue a previous session
- `acolyte run "<prompt>"`: one-shot execution
- `acolyte run --file <path> "<prompt>"`: one-shot with file context
- `acolyte history`: list sessions
- `acolyte start|stop|restart|ps`: manage server lifecycle
- `acolyte status`: show server status
- `acolyte memory list|add`: manage memory
- `acolyte config list|set|unset`: manage configuration
- `acolyte skill <name> [prompt]`: run a prompt with an active skill
- `acolyte trace list|task <id>`: inspect server lifecycle traces

Run `acolyte <command> help` for detailed usage.

## Local models

See [Configuration](./configuration.md) for OpenAI-compatible model setup.

## Memory commands

```bash
acolyte memory list [all|user|project]
acolyte memory add --user "<text>"
acolyte memory add --project "<text>"
```

## Config commands

```bash
acolyte config list [--project]
acolyte config set <key> <value>
acolyte config set --project <key> <value>
acolyte config unset <key>
```

See [Configuration](./configuration.md) for available keys.

## Trace commands

```bash
acolyte trace                    # list recent tasks
acolyte trace list               # same as above
acolyte trace task <id>          # inspect a task's lifecycle trace
acolyte trace task <id> --json   # output as JSON lines
acolyte trace --lines 100        # show last 100 tasks
acolyte trace --log <path>       # use a custom log file
```
