# CLI

The CLI is the primary interface for working with Acolyte.

## Commands

- `acolyte`: start interactive chat
- `acolyte run "<prompt>"`: one-shot execution
- `acolyte run --file <path> "<prompt>"`: one-shot with file context
- `acolyte resume [id-prefix]`: continue a previous session
- `acolyte history`: list sessions
- `acolyte status`: show server status
- `acolyte start|stop|restart|ps`: manage server lifecycle
- `acolyte memory list|add`: manage memory
- `acolyte config list|set|unset`: manage configuration
- `acolyte tool <tool-id> [args]`: run a tool directly
- `acolyte trace [task|request] [id] [--json]`: inspect server lifecycle traces
- `acolyte init [provider]`: initialize provider API key

Run `acolyte <command> help` for detailed usage.

## Local models

See [Configuration](./configuration.md) for OpenAI-compatible model setup.

## Chat commands

These are available in interactive chat:

- `/exit`: exit chat
- `/new`: start new session
- `/resume`: resume a previous session
- `/sessions`: show sessions
- `/status`: show server status
- `/usage`: show token usage
- `/model [id]`: change model
- `/model work|verify <id>`: change mode-specific model
- `/permissions [read|write]`: change permission mode
- `/memory [all|user|project]`: show memory notes
- `/remember [--user|--project] <text>`: save memory note
- `/skill <name>`: run a skill command
- `/skills`: show skills picker

## File attachments

Use `@path` in chat input to attach file or directory context:

```
@src/cli.ts refactor the help text
@docs/ summarize the documentation
```

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
