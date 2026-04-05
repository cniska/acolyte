---
name: acolyte
description: Guide for working on the Acolyte codebase. Use when building features, fixing bugs, or extending Acolyte itself.
---

# Working on Acolyte

Read `AGENTS.md` for invariants. This skill covers extension patterns and architecture beyond what the rules file provides.

## System flow

```
CLI → client → server → lifecycle → model + tools
```

Lifecycle phases: resolve → prepare → generate → finalize. The model runs in generate; tools execute via `runTool`. Effects apply per-tool-result during generate.

## Adding a tool

1. Create `src/{domain}-toolkit.ts` (or add to existing one)
2. Define Zod input/output schemas
3. Create tool with `createTool({ id, toolkit, category, description, instruction, inputSchema, outputSchema, execute })`
4. Inside `execute`, call `runTool(input.session, toolId, toolCallId, toolInput, async (callId) => { ... })`
5. Emit output via `input.onOutput({ toolName, content, toolCallId })` for streaming feedback
6. Return typed result matching `outputSchema`
7. Export a `create{Domain}Toolkit(input: ToolkitInput)` factory returning all tools
8. Register in `src/tool-registry.ts`: add to `TOOLKIT_REGISTRY` and `RegisteredToolkit` type

Categories: `read`, `search`, `write`, `execute`, `network`, `meta`.

## Adding a bundled skill

1. Create `docs/skills/{name}.md` with frontmatter (`name`, `description`) and body
2. Add text import in `src/bundled-skills.ts`: `import {name}Md from "../docs/skills/{name}.md" with { type: "text" }`
3. Add entry to `BUNDLED_SKILLS` array

## Adding a project skill

1. Create `.agents/skills/{name}/SKILL.md` with frontmatter and body
2. Scanned automatically — no registration needed

## Adding a lifecycle effect

1. Define `Effect` in `src/lifecycle-effects.ts`
2. Add to `EFFECTS` array
3. Effects run per-tool-result during generate phase via callback

## Adding an ecosystem detector

1. Define `EcosystemDetector` in `src/workspace-detectors.ts`
2. Add to `ECOSYSTEM_DETECTORS` array
3. Detectors run during workspace profile resolution

## Key modules

| Module | Purpose |
|--------|---------|
| `tool-contract.ts` | `ToolDefinition`, `createTool`, `ToolkitInput` |
| `tool-execution.ts` | `runTool` — budget, cache, hooks, recording |
| `tool-registry.ts` | `TOOLKIT_REGISTRY`, `Toolset`, `toolsForAgent` |
| `tool-session.ts` | `SessionContext`, step budget, call log |
| `skills.ts` | Skill loading, bundled/project merge, cache |
| `bundled-skills.ts` | Embedded bundled skill content via text imports |
| `lifecycle.ts` | Lifecycle orchestration |
| `lifecycle-generate.ts` | Model + tool execution loop |
| `lifecycle-effects.ts` | Per-tool-result side effects |
| `memory-ops.ts` | Memory CRUD operations |
| `memory-store.ts` | SQLite-backed memory persistence |
| `agent-instructions.ts` | System prompt assembly |
| `soul.ts` | Soul + AGENTS.md loading |

## Testing patterns

- Unit tests: `src/{module}.test.ts`
- Integration tests: `src/{module}.int.test.ts`
- TUI visual tests: `src/{module}.tui.test.ts`
- Use `tempDir()` from `test-utils.ts` for filesystem fixtures
- Use `tempDb()` from `test-utils.ts` for SQLite test stores
- Use `createSessionContext()` for tool execution tests
- Always `resetSkillCache()` in skill tests
