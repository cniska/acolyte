# Acolyte Dogfood Workflow

## Goal
Run daily development with Acolyte as the primary driver while keeping reliability checks tight.

## Start
1. Terminal 1 (backend + chat app):
   - `bun run dev`
2. Terminal 2 (interactive CLI):
   - `acolyte`
   - Fallback: `bun run src/cli.ts`

## Slice Loop
1. Ask for one small slice at a time.
2. Require validation before commit:
   - `bun run verify`
3. Commit one logical slice:
   - commit message in Conventional Commit format.
4. Repeat.

## Readiness Loop
Run this regularly while dogfooding:
1. Fast gate (no duplicate verify run):
   - `bun run dogfood:gate -- --skip-verify --lookback 10 --target 6`
2. Full gate when needed:
   - `bun run dogfood:gate -- --lookback 30 --target 10`

Interpretation:
1. `result: ready` means smoke checks are green and enough delivery slices are present.
2. `remaining=<n>` in delivery detail shows exactly how many slices are still missing.

## Session Continuity
1. In chat:
   - `/sessions`
   - `/resume <id-prefix>`
   - `/new`
2. From shell:
   - `acolyte resume <id-prefix>`
   - Fallback: `bun run src/cli.ts resume <id-prefix>`

## Memory Usage During Dogfood
1. Save preferences:
   - `/remember <text>`
   - `/remember --project <text>`
2. Inspect memory:
   - `/memory [all|user|project]`
   - `/memory context [all|user|project]`

## Troubleshooting
1. Backend not reachable:
   - `bun run serve:env`
2. OM/admin checks:
   - `bun run om:status`
   - `bun run om:status -- --help`
3. Dogfood scripts help:
   - `bun run dogfood:progress -- --help`
   - `bun run dogfood:gate -- --help`

