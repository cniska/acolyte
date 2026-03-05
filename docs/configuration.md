# Configuration

Configuration is loaded from user scope and project scope, with project values overriding user values.

Paths:
- user: `~/.acolyte/config.toml`
- project: `<cwd>/.acolyte/config.toml`

## Common commands

```bash
acolyte config list
acolyte config set model gpt-5-mini
acolyte config set --project transportMode rpc
acolyte config unset apiUrl
```

## Memory-related keys

- `memoryBudgetTokens`: memory injection budget.
- `memorySources`: Memory Source Strategy (`stored`, `distill`) and order.
- `distillModel`: model used by distill source.
- `distillMessageThreshold`: observation trigger threshold.
- `distillReflectionThresholdTokens`: reflection trigger threshold.
- `distillMaxOutputTokens`: output cap for distill records.

## Memory controls

- `memoryBudgetTokens=0` disables memory injection globally.
- `useMemory=false` disables memory injection and commit for one request.
