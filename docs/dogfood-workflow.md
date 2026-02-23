# Acolyte Dogfood Workflow

## Goal
Use Acolyte as the primary development driver and ship in small, verified slices.

## Setup
Run once:

```bash
acolyte config set --project model "openai/gpt-5"
acolyte config set --project modelPlanner "openai/o3"
acolyte config set --project modelCoder "openai/gpt-5-codex"
acolyte config set --project modelReviewer "openai/o3"
acolyte config set apiUrl "http://localhost:6767"
```

Set API key in `.env`:

```bash
OPENAI_API_KEY=...
```

Run backend with logs in both terminal and file (recommended for dogfooding):

```bash
mkdir -p .acolyte/logs
bun --env-file=.env run src/server.ts 2>&1 | tee -a .acolyte/logs/server.log
```

Use `--watch` only when actively editing backend code. In watch mode, server restarts can interrupt long-running agent turns.

After setup, restart chat and check:

```text
/status
```

Expected:
- backend is not `embedded`
- provider is not `local-mock`

## Start Of Day

```bash
bun run dev
```

`bun run dev` starts backend + chat together. Enter prompts in that same terminal.

Then in chat:

```text
/status
/remember --project when I ask "what's next", pick the highest-priority unfinished item in docs/project-plan.md and propose one smallest verifiable slice
```

## Per Slice Loop (Practical)
In chat:

```text
what next
do it, run bun run verify, then commit with a conventional commit message
```

If verify fails:

```text
fix the failure, rerun bun run verify, and commit
```

Repeat with:

```text
what next
```

## End Of Day

```bash
bun run dogfood:gate -- --lookback 30 --target 10
```

If not ready, note `remaining=<n>` and continue next session.

Resume later with:

```bash
acolyte resume <id-prefix>
```

## Restart Matrix
- If you run `bun run dev`:
  - restart `bun run dev` after `.env` changes, CLI changes, or backend/server changes.
- If you run split mode:
  - restart `acolyte` after `acolyte config set ...`, `.env` changes, or CLI changes.
  - restart backend after `.env` changes, or backend/server changes when not running watch mode.
- No restart needed for normal prompts/commands and `/remember` or `/memory` updates.

## Readiness Checks

```bash
bun run dogfood:gate -- --skip-verify --lookback 10 --target 6
bun run dogfood:gate -- --lookback 30 --target 10
```

- `result: ready` means checks are green and slice target is met.
- `remaining=<n>` means how many more slices are needed.

## Troubleshooting

```bash
bun run serve:env
bun run om:status
bun run dogfood:progress -- --help
bun run dogfood:gate -- --help
```

Split mode (optional):

```bash
# terminal 1
bun run serve:env

# terminal 2
acolyte
```

## References
- `README.md` for full command reference.
