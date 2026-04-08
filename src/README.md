# src/

Flat directory, ~200 modules, no nesting.

## Why flat

Flat makes scanning fast — both for humans and AI agents. Every module is one `grep` away, no tree navigation required. The naming convention (`<domain>-<concern>.ts`) carries the structure without folders, and avoids import path churn while module boundaries are still shifting.

As the codebase grows, the plan is to introduce light module folders. See #134.

## Naming convention

Files are named `<domain>-<concern>.ts`. The domain prefix groups related modules. See [architecture](../docs/architecture.md) for how these connect at runtime.

| Prefix | Domain | Entry point |
| --- | --- | --- |
| `lifecycle-*` | Single-pass agent pipeline (resolve, prepare, generate, finalize) | `lifecycle.ts` |
| `agent-*` | Model streaming, tool dispatch, context assembly | `agent-stream.ts` |
| `tool-*` | Tool registry, execution, error handling, output formatting | `tool-registry.ts` |
| `file-*` | File read/write/search operations | `file-toolkit.ts` |
| `code-*` | AST-based code search and editing (ast-grep) | `code-toolkit.ts` |
| `shell-*` | Sandboxed shell execution | `shell-toolkit.ts` |
| `git-*` | Git operations | `git-toolkit.ts` |
| `web-*` | Web fetch and search | `web-toolkit.ts` |
| `memory-*` | Context distillation and persistent memory | `memory-toolkit.ts` |
| `checklist-*` | Task tracking within a session | `checklist-toolkit.ts` |
| `undo-*` | Undo checkpoints for file edits | `undo-toolkit.ts` |
| `chat-*` | TUI chat application | `chat-app.tsx` |
| `cli-*` | CLI entry, subcommands, daemon management | `cli.ts` |
| `server-*` | HTTP server, RPC, daemon lifecycle | `server.ts` |
| `client-*` | RPC client, contract validation | `client-rpc.ts` |
| `session-*` | Session persistence and token accounting | `session-store.ts` |
| `config*` | User/project configuration (TOML) | `config.ts` |
| `provider-*` | LLM provider detection and model routing | `provider-config.ts` |
| `rate-limiter*` | Rate limit detection, retry, preemptive pacing | `rate-limiter.ts` |
| `workspace-*` | Workspace detection, sandboxing, profiles | `workspace-sandbox.ts` |
| `rpc-*` | WebSocket RPC protocol | `rpc-protocol.ts` |
| `task-*` | Background task queue and registry | `task-queue.ts` |
| `error-*` | Error codes, contracts, serialization | `error-contract.ts` |
| `skill-*` | Skill loading and activation | `skills.ts` |
| `cloud-*` | Cloud API client | `cloud-client.ts` |

## Contracts

Files ending in `-contract.ts` define types, schemas, and constants shared across module boundaries. They have no runtime dependencies on implementation modules. Read these first to understand a domain.

## Test files

See [testing](../docs/testing.md) for test boundaries.

| Suffix | Purpose |
| --- | --- |
| `.test.ts` | Unit tests (fast, no I/O) |
| `.int.test.ts` | Integration tests (may spawn processes, touch filesystem) |
| `.tui.test.tsx` | TUI visual regression tests |
| `.perf.ts` | Performance baselines |

## Subdirectories

| Directory | Content |
| --- | --- |
| `tui/` | Custom React reconciler and rendering engine for the terminal UI |
| `i18n/` | Localization strings and locale loading |
