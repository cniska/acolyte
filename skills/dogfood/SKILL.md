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
2. Run the standard test suite and report results.
3. Identify instruction issues and propose fixes.
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

## Testing new features

When dogfooding a new feature:

1. **Design test prompts** that exercise the feature in realistic scenarios.
2. **Run them** and check: does the agent use the feature correctly? Does it pick the right tool?
3. **Check edge cases**: wrong input, missing files, large output, error paths.
4. **Check server logs**: `tail -50 /tmp/acolyte-server.log` for errors or crashes.
5. **Iterate** on instructions/toolMeta if the agent misuses or ignores the feature.

## Tuning instructions

### Standard test suite

| Mode | Prompt | Expected |
|------|--------|----------|
| plan | `what does the classifyMode function do and where is it used?` | Search + Read, concise summary, all usages |
| plan | `find all places in src/ where we call withToolError` | 1-2 tools, list all sites |
| work | `change the INITIAL_MAX_STEPS constant from 50 to 40 in src/agent.ts` | Read, Edit, Verify |
| work | `rename the statusText field to progressLabel, update all references` | Multi-file: search, edit all, verify |
| structural | `find all arrow functions in src/agent-tools.ts that are exported` | scan-code, minimal flailing |

### What to measure

- **Tool call count**: plan 1-4, simple work 3-5. Fewer is better.
- **Redundant reads**: same file read multiple times = red flag.
- **Narration**: agent should act, not describe. "I'll search..." before tools is unwanted.
- **Tool choice**: scan-code for structure, search-files for text, edit-file for simple edits.
- **Stop signal**: stop once the answer is found.

### Iterate

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
