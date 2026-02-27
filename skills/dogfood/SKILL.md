---
name: dogfood
description: Run Acolyte against itself to test and improve agent instructions
---

# Dogfood

Test Acolyte's agent by running prompts through `bun run src/cli.ts run` and analyzing the results to improve instructions, tool preambles, and mode behavior.

## Setup

1. Start the server (non-watch mode, log to file):
   ```
   kill $(lsof -t -i :6767) 2>/dev/null
   bun run src/server.ts > /tmp/acolyte-server.log 2>&1 &
   ```
2. Verify it's running: `curl -s http://localhost:6767/v1/status | head -1`

## Run test prompts

Run prompts in parallel via background commands. Stagger by 1-2 seconds to avoid request overlap:

```
bun run src/cli.ts run '<prompt>' 2>&1
```

### Standard test suite

Use these prompts to cover the three modes. Run before/after instruction changes to compare:

| Mode | Prompt | Expected |
|------|--------|----------|
| plan | `what does the classifyMode function do and where is it used?` | Search + Read, concise summary, find all usages |
| plan | `find all places in src/ where we call withToolError` | 1-2 tool calls, list all call sites |
| work | `change the INITIAL_MAX_STEPS constant from 50 to 40 in src/agent.ts` | Read once, Edit, Verify. Revert after. |
| work | `rename the progressText field to statusText, update all references` | Multi-file: search refs, edit all, verify. Revert after. |
| structural | `find all arrow functions in src/agent-tools.ts that are exported` | Should use scan-code, minimal flailing |

### What to measure

- **Tool call count**: fewer is better. Plan tasks should be 1-4 calls. Simple work tasks should be 3-5 (read, edit, verify).
- **Redundant reads**: reading the same file multiple times is a red flag.
- **Preamble narration**: the agent should act, not describe. Text like "I'll search the repository..." before tool calls is unwanted.
- **Correct tool choice**: scan-code for structural queries, search-files for text/regex, edit-file for simple edits, edit-code for multi-location.
- **Stop signal**: agent should stop searching once it has enough info, not keep going for completeness.

## Analyze results

After each run, check:

1. **Output quality**: Did the agent answer correctly? Did it find all references?
2. **Tool efficiency**: Count tool calls, identify redundant ones.
3. **Server logs**: `tail -50 /tmp/acolyte-server.log` — look for errors, crashes, or unexpected behavior.
4. **Instruction compliance**: Did the agent follow mode preamble instructions?

## Iterate

1. Identify the instruction or toolMeta causing the issue.
2. Edit `src/agent-modes.ts` (preambles), `src/mastra-tools.ts` (tool instructions), or `src/agent.ts` (base instructions).
3. Run `bun run verify` to ensure tests pass. Update test expectations if instruction text changed.
4. Restart the server: `kill $(lsof -t -i :6767); bun run src/server.ts > /tmp/acolyte-server.log 2>&1 &`
5. Re-run the same prompts and compare before/after.

## Key files

| File | Contains |
|------|----------|
| `src/agent-modes.ts` | Mode preambles, tool lists, mode classification |
| `src/mastra-tools.ts` | `toolMeta` with per-tool instructions and aliases |
| `src/agent.ts` | `BASE_INSTRUCTIONS`, `createModeInstructions()`, `createInstructions()` |
| `src/app-config.ts` | Output budgets per tool |

## Dump current instructions

```
bun -e 'import { createModeInstructions } from "./src/agent.ts"; for (const m of ["plan","work","verify"]) { console.log(`\n=== ${m.toUpperCase()} ===`); console.log(createModeInstructions(m)); }'
```

## Cleanup

After dogfooding, revert any test edits made by the agent:
```
git checkout -- src/agent.ts src/agent-modes.ts
```

Restart the server if code was changed:
```
kill $(lsof -t -i :6767); bun run src/server.ts > /tmp/acolyte-server.log 2>&1 &
```
