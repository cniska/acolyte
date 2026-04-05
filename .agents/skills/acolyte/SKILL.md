---
name: acolyte
description: Guide for working on the Acolyte codebase. Use when building features, fixing bugs, or extending Acolyte itself.
---

# Acolyte

Map of the codebase for contributors. Read `AGENTS.md` for invariants. This skill points you to the right place — docs have the detail.

## System flow

```
CLI → daemon (RPC) → lifecycle → model + tools
```

- Lifecycle is single-pass: resolve → prepare → generate → finalize. See `docs/lifecycle.md`.
- Tools execute via `runTool` through budget → cache → toolkit → registry layers. See `docs/tooling.md`.
- TUI is a custom React reconciler with `Box`, `Text`, `Static`. See `docs/tui.md`.
- Memory is on-demand via toolkit, not injected. Observer distills facts at finalize. See `docs/memory.md`.
- Workspace sandbox scopes filesystem access to the project root. See `docs/workspace.md`.
- RPC uses WebSocket JSON envelopes with task lifecycle state machine. See `docs/protocol.md`.

## Extension patterns

**Add a tool**: Create or extend `src/{domain}-toolkit.ts` with `createTool` + `runTool`, register in `src/tool-registry.ts`. See `docs/tooling.md`.

**Add a bundled skill**: Create `docs/skills/{name}.md`, add text import in `src/bundled-skills.ts`, add to `BUNDLED_SKILLS` array.

**Add a project skill**: Create `.agents/skills/{name}/SKILL.md`. Scanned automatically.

**Add a lifecycle effect**: Define `Effect` in `src/lifecycle-effects.ts`, add to `EFFECTS`. See `docs/lifecycle.md`.

**Add an ecosystem detector**: Define `EcosystemDetector` in `src/workspace-detectors.ts`, add to `ECOSYSTEM_DETECTORS`. See `docs/workspace.md`.

## Testing

Unit (`*.test.ts`), integration (`*.int.test.ts`), visual (`*.tui.test.ts`), perf (`*.perf.test.ts`). Helpers: `tempDir()`, `tempDb()`, `createSessionContext()`. Full check: `bun run verify`. See `docs/testing.md`.

## Config

User `~/.acolyte/config.toml`, project `<cwd>/.acolyte/config.toml`. Project overrides user. See `docs/configuration.md`.
