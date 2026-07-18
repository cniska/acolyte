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

| Subsystem | Key concepts | Docs |
|-----------|-------------|------|
| Lifecycle | Single-pass: resolve → prepare → generate → finalize. Effects apply per-tool-result. Model ends the turn with a native `end_turn` (a step with no tool calls); that step's text is the final response | `docs/lifecycle.md` |
| Tools | `runTool`: budget → cache → toolkit → registry. Toolkits cover file, code, undo, session, signal, memory, skill, test, checklist, gh, git, web, and shell | `docs/tooling.md` |
| Sessions | Persistent conversation context, history, model selection, and token usage | `docs/sessions.md` |
| Tasks | State machine: accepted → queued → running → completed\|failed\|cancelled | `docs/tasks.md` |
| Memory | On-demand via toolkit, not injected. Observer distills facts via `memory-observe` tool calls. SQLite + semantic embeddings | `docs/memory.md` |
| TUI | Custom React reconciler. Three primitives: `Box`, `Text`, `Static` | `docs/tui.md` |
| Providers | Pluggable: OpenAI, Anthropic, Google, Vercel AI Gateway, OpenAI-compatible locals | `docs/configuration.md` |
| Workspace | Sandbox scopes file ops to project root. Profile detection infers ecosystem and commands | `docs/workspace.md` |
| Protocol | WebSocket JSON envelopes with request correlation and task state transitions | `docs/protocol.md` |
| CLI | Command registry, daemon spawn, argument parsing | `docs/cli.md` |
| Errors | Structured error codes and kinds, consistent shaping across layers | `docs/errors.md` |
| Localization | Locale catalogs in `src/i18n/locales/*.json`, `en` fallback | `docs/localization.md` |

## What to read when

| Task | Start here |
|------|-----------|
| Adding or modifying a tool | `docs/tooling.md`, then the relevant `*-toolkit.ts` |
| Changing lifecycle behavior | `docs/lifecycle.md`, then `src/lifecycle-*.ts` |
| Working on the TUI | `docs/tui.md`, then `src/tui/` |
| Changing memory behavior | `docs/memory.md`, then `src/memory-*.ts` |
| Adding a provider | `src/provider-*.ts`, `docs/configuration.md` |
| Modifying RPC or task flow | `docs/protocol.md`, `docs/sessions.md`, `docs/tasks.md` |
| Changing workspace detection | `docs/workspace.md`, then `src/workspace-*.ts` |
| Adding a CLI command | `docs/cli.md`, then `src/cli-command-registry.ts` |
| Adding or changing error codes | `docs/errors.md`, then `src/error-contract.ts` |
| Updating bundled skills | `docs/skills/{name}.md`; these are Acolyte's built-in skills. |

## Extension patterns

| Extension | How |
|-----------|-----|
| Tool | Create or extend `src/{domain}-toolkit.ts` with `createTool` + `runTool`, register in `src/tool-registry.ts` |
| Bundled skill | Create `docs/skills/{name}.md`, add text import in `src/bundled-skills.ts`, add to `BUNDLED_SKILLS` |
| Project skill | Create `.agents/skills/{name}/SKILL.md` — scanned automatically |
| Lifecycle effect | Define `Effect` in `src/lifecycle-effects.ts`, add to `PRE_EFFECTS` or `POST_EFFECTS` |
| Ecosystem detector | Define `EcosystemDetector` in `src/workspace-detectors.ts`, add to `ECOSYSTEM_DETECTORS` |
| Provider | Add `src/provider-{name}.ts`, register in provider resolution |
| CLI command | Add to `src/cli-command-registry.ts` |

## Testing

| Type | Pattern | When to use |
|------|---------|-------------|
| Unit | `*.test.ts` | Pure logic, schemas, contracts |
| Integration | `*.int.test.ts` | Real server/lifecycle/tool wiring |
| Visual | `*.tui.test.tsx` | TUI rendering snapshots |
| Perf | `*.perf.test.ts` | Latency trend detection |

Helpers: `tempDir()` for filesystem fixtures, `tempDb()` for SQLite stores, `createSessionContext()` for tool tests. Full check: `bun run verify`. See `docs/testing.md`.
