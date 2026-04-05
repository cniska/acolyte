---
name: acolyte
description: Guide for working on the Acolyte codebase. Use when building features, fixing bugs, or extending Acolyte itself.
---

# Acolyte

Acolyte is a terminal-first AI coding agent: local-first, observable, extensible. This skill is a map of the codebase — it tells you where to look. Read `AGENTS.md` for invariants and rules. Read the linked docs for detail.

## Architecture

```
CLI → daemon (RPC) → lifecycle → model + tools
```

**Lifecycle** executes one request in a single pass: resolve → prepare → generate → finalize. The model runs during generate. Effects apply per-tool-result. The model ends its turn with `@signal done|no_op|blocked`. See `docs/lifecycle.md`.

**Tools** execute through `runTool`: budget check → cache → toolkit → registry. Nine toolkits: file, code, web, shell, test, git, checklist, memory, skill. See `docs/tooling.md`.

**Sessions and tasks** are separate concerns. One active task per session. Tasks follow a state machine: accepted → queued → running → completed|failed|cancelled. See `docs/sessions-tasks.md`.

**Memory** is on-demand via the memory toolkit, not injected into the prompt. The observer distills facts from conversations using `@observe` directives at finalize. Storage is SQLite with semantic embeddings. See `docs/memory.md`.

**TUI** is a custom React reconciler for terminal rendering. Three primitives: `Box`, `Text`, `Static`. See `docs/tui.md`.

**Providers** are pluggable: OpenAI, Anthropic, Google, Vercel AI Gateway, and OpenAI-compatible locals. See `docs/configuration.md`.

**Workspace** sandbox scopes all file operations to the project root. Profile detection infers ecosystem, package manager, and format/lint/test commands. See `docs/workspace.md`.

**Protocol** uses WebSocket JSON envelopes with request correlation and task state transitions. See `docs/protocol.md`.

## What to read when

| Task | Start here |
|------|-----------|
| Adding or modifying a tool | `docs/tooling.md`, then the relevant `*-toolkit.ts` |
| Changing lifecycle behavior | `docs/lifecycle.md`, then `src/lifecycle-*.ts` |
| Working on the TUI | `docs/tui.md`, then `src/tui/` |
| Changing memory behavior | `docs/memory.md`, then `src/memory-*.ts` |
| Adding a provider | `src/provider-*.ts`, `docs/configuration.md` |
| Modifying RPC or task flow | `docs/protocol.md`, `docs/sessions-tasks.md` |
| Changing workspace detection | `docs/workspace.md`, then `src/workspace-*.ts` |

## Extension patterns

**Add a tool**: Create or extend `src/{domain}-toolkit.ts` with `createTool` + `runTool`, register in `src/tool-registry.ts`.

**Add a bundled skill**: Create `docs/skills/{name}.md`, add text import in `src/bundled-skills.ts`, add to `BUNDLED_SKILLS`.

**Add a project skill**: Create `.agents/skills/{name}/SKILL.md`. Scanned automatically.

**Add a lifecycle effect**: Define `Effect` in `src/lifecycle-effects.ts`, add to `EFFECTS`.

**Add an ecosystem detector**: Define `EcosystemDetector` in `src/workspace-detectors.ts`, add to `ECOSYSTEM_DETECTORS`.

## Testing

| Type | Pattern | When to use |
|------|---------|-------------|
| Unit | `*.test.ts` | Pure logic, schemas, contracts |
| Integration | `*.int.test.ts` | Real server/lifecycle/tool wiring |
| Visual | `*.tui.test.ts` | TUI rendering snapshots |
| Perf | `*.perf.test.ts` | Latency trend detection |

Helpers: `tempDir()` for filesystem fixtures, `tempDb()` for SQLite stores, `createSessionContext()` for tool tests. Full check: `bun run verify`. See `docs/testing.md`.
