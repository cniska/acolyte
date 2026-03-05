# CLI

The CLI is the primary developer interface for local workflows.

## Core commands

- `acolyte run "<prompt>"`: one-shot execution.
- `acolyte resume [id-prefix]`: continue a previous session.
- `acolyte history`: list sessions.
- `acolyte status`: show server/runtime status.
- `acolyte server <start|stop|status>`: manage local server lifecycle.

## Memory commands

- `acolyte memory list`
- `acolyte memory add --user "<text>"`
- `acolyte memory add --project "<text>"`

`stored` Memory Source reads these Markdown records.

## Config commands

- `acolyte config list`
- `acolyte config set <key> <value>`
- `acolyte config set --project <key> <value>`
- `acolyte config unset <key>`
