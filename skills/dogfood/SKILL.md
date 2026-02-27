---
name: dogfood
description: Dogfood Acolyte — test features, tune instructions, and validate changes by running the agent against itself
---

# Dogfood

Run Acolyte against itself to test new features, tune agent instructions, and validate changes.

## What to do

$ARGUMENTS

If no arguments, pick the next useful action:

1. Ensure the server is running (see Setup).
2. Design and run prompts against Acolyte.
3. Analyze results — identify instruction issues.
4. Apply fixes, verify, restart server, re-test.

## Setup

Ensure the server is running (non-watch mode — watch restarts kill in-flight requests):

```
kill $(lsof -t -i :6767) 2>/dev/null; bun run src/server.ts > /tmp/acolyte-server.log 2>&1 &
```

Verify: `curl -s http://localhost:6767/v1/status | head -1`

After code changes, restart: `kill $(lsof -t -i :6767); bun run src/server.ts > /tmp/acolyte-server.log 2>&1 &`

## Running prompts

```
bun run src/cli.ts run '<prompt>' 2>&1
```

Run multiple in parallel as background commands. Stagger by 1-2s. Revert any test edits after (`git checkout -- <file>`).

## Designing prompts

Pick tasks that stress real patterns — don't use canned tests. Good prompts:

- **Real coding work**: add a function, fix a bug, refactor a module, rename across files.
- **Cross-file reasoning**: "how does X work?", "trace the code path for Y".
- **Edge cases**: missing files, ambiguous instructions, large outputs.
- **Feature-specific**: if testing a new feature, craft prompts that exercise it directly.

## What to measure

- **Tool call count**: plan 1-4, simple work 3-5. Fewer is better.
- **Redundant reads**: same file read multiple times = red flag.
- **Narration**: agent should act, not describe. "I'll search..." before tools is unwanted.
- **Tool choice**: scan-code for structure, search-files for text, edit-file for simple edits.
- **Shell fallbacks**: using sed/cat/node to read files instead of read-file = red flag.
- **Stop signal**: stop once the answer is found.

## Iterating on instructions

1. Edit `src/agent-modes.ts` (preambles), `src/mastra-tools.ts` (toolMeta), or `src/agent.ts` (base instructions).
2. Run `bun run verify`. Update test expectations if instruction text changed.
3. Restart server, re-run same prompts, compare before/after.

## Dump current instructions

```
bun -e 'import { createModeInstructions } from "./src/agent.ts"; for (const m of ["plan","work","verify"]) { console.log(`\n=== ${m.toUpperCase()} ===`); console.log(createModeInstructions(m)); }'
```

## Key files

| File | Contains |
|------|----------|
| `src/agent-modes.ts` | Mode preambles, tool lists, mode classification |
| `src/mastra-tools.ts` | `toolMeta` — per-tool instructions and aliases |
| `src/agent.ts` | `BASE_INSTRUCTIONS`, `createModeInstructions()`, `createInstructions()` |
| `src/app-config.ts` | Output budgets per tool |

## Cleanup

```
git checkout -- src/agent.ts src/agent-modes.ts
kill $(lsof -t -i :6767); bun run src/server.ts > /tmp/acolyte-server.log 2>&1 &
```
