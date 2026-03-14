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
- `acolyte init [provider]`: initialize provider setup

Run `acolyte <command> help` for detailed usage.

## Local models

Configure the project to talk to a local OpenAI-compatible server, then set the project model explicitly:

```bash
acolyte config set --project openaiBaseUrl http://localhost:11434/v1
acolyte config set --project model openai-compatible/<model>
```

## Chat commands

These are available inside interactive chat mode:

- `/exit`: exit chat
- `/new`: start new session
- `/resume`: resume a previous session
- `/sessions`: show sessions
- `/status`: show server status
- `/tokens`: show token usage
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
