# Code Quality Benchmarks

Measured comparisons of Acolyte against two prominent open-source AI coding agents.
All metrics are from source code analysis — no opinions, just counts.

## Projects Compared

| Project | Description | Source Lines | Files | Dependencies |
|---|---|---|---|---|
| **Acolyte** | CLI-first AI coding agent with lifecycle, guards, and evaluators | 16,095 | 129 | 18 |
| **OpenCode** | Open-source AI coding agent (TUI/web/desktop) | 60,655 | 297 | 103 |
| **Pi** | Terminal coding agent harness with extensions | 97,279 | 387 | 59 |

Source lines exclude test files and generated code. Dependencies are runtime + dev combined.

## Type Safety

| Metric | Acolyte | Acolyte /1k | OpenCode | OpenCode /1k | Pi | Pi /1k |
|---|---|---|---|---|---|---|
| `as any` | 1 | 0.06 | 43 | 0.7 | 129 | 1.3 |
| `: any` annotations | 0 | 0.0 | 86 | 1.4 | 117 | 1.2 |
| Non-null `!.` assertions | 0 | 0.0 | 34 | 0.6 | 18 | 0.2 |
| `@ts-ignore` / `@ts-expect-error` | 0 | 0.0 | 21 | 0.3 | 0 | 0.0 |
| `: unknown` usage | 69 | 4.3 | 40 | 0.7 | 85 | 0.9 |

Acolyte has **1 total `any`** (an FFI boundary for ast-grep). It uses `unknown` with explicit narrowing at 4–6x the rate of the other projects.

## Tech Debt

| Metric | Acolyte | Acolyte /1k | OpenCode | OpenCode /1k | Pi | Pi /1k |
|---|---|---|---|---|---|---|
| TODO / FIXME / HACK | 0 | 0.0 | 22 | 0.4 | 3 | 0.03 |
| Comment lines (`//`) | 62 | 3.9 | 1,156 | 19.1 | 5,278 | 54.3 |
| `console.log` in source | 8 | 0.5 | 104 | 1.7 | 366 | 3.8 |

Zero tech debt markers. Low comment density reflects self-documenting code with external docs.

## Test Quality

| Metric | Acolyte | OpenCode | Pi |
|---|---|---|---|
| Test files | 83 | 87 + 42 e2e | 105 |
| Test lines | 13,200 | 27,295 + 4,761 e2e | 31,833 |
| Test / source line ratio | **0.82** | 0.45 | 0.33 |
| Test files / source files | 0.64 | 0.29 | 0.27 |
| Test types | 4 (unit, int, tui, perf) | 2 (unit, e2e) | 1 (unit) |
| Unit test files | 64 | 87 | 105 |
| Integration test files | 19 | 0 (separate e2e) | — |

Acolyte's test-to-source ratio is **2–2.5x** the other projects. It also maintains a structured test taxonomy with four dedicated test types: unit (`*.test.ts`), integration (`*.int.test.ts`), TUI visual regression (`*.tui.test.ts`), and performance (`*.perf.test.ts`).

## Module Cohesion

| Metric | Acolyte | OpenCode | Pi |
|---|---|---|---|
| Avg lines / file | 125 | 204 | 251 |
| Files > 300 lines | 11 (8.5%) | 48 (16.2%) | 94 (24.3%) |
| Files > 500 lines | 3 (2.3%) | 27 (9.1%) | 48 (12.4%) |
| Largest file | 1,181 | 2,248 | 4,401 |
| Barrel / index files | 1 | 29 | 26 |

Flat `src/` layout with small, focused files. No barrel-file chains.

## Error Handling

| Metric | Acolyte | Acolyte /1k | OpenCode | OpenCode /1k | Pi | Pi /1k |
|---|---|---|---|---|---|---|
| `.safeParse()` calls | 25 | 1.6 | 13 | 0.2 | 0 | 0.0 |
| `try { ... }` blocks | 111 | 6.9 | 126 | 2.1 | 402 | 4.1 |
| `.catch()` calls | 6 | 0.4 | 262 | 4.3 | 32 | 0.3 |

Acolyte validates at boundaries with Zod `.safeParse()` rather than relying on exception-driven error handling.

## Code Patterns

| Metric | Acolyte | Acolyte /1k | OpenCode | OpenCode /1k | Pi | Pi /1k |
|---|---|---|---|---|---|---|
| `readonly` usage | 65 | 4.0 | 27 | 0.4 | 27 | 0.3 |
| `as const` assertions | 22 | 1.4 | 96 | 1.6 | 130 | 1.3 |
| Exported type aliases | 134 | 8.3 | 66 | 1.1 | 164 | 1.7 |

Immutability discipline (`readonly`) is 10–13x higher per line than both projects.

## Architecture

| Capability | Acolyte | OpenCode | Pi |
|---|---|---|---|
| Transport | Daemon + HTTP + WebSocket RPC | REST + SSE + WebSocket | JSON-lines RPC over stdio |
| Typed protocol | Zod-validated, versioned | Implicit contract | TypeScript union types |
| Task queue | Explicit states, ordering, cancellation | Session busy flag | Steer / follow-up modes |
| Request correlation | request_id + task_id + session_id | Session-level | Optional id per command |
| Tool guards | 7 behavioral guards | Permission-based only | Extension-based tool blocking |
| Post-generation evaluators | 6 evaluators (accept/retry/regenerate) | None | None |
| Verification loop | Enforced, task-scoped | Prompt-level only | Prompt-level only |
| AST tools | ast-grep (scan + edit) | None | None |

## Summary

| Dimension | Acolyte | OpenCode | Pi |
|---|---|---|---|
| Type safety | Best | Weakest | Middle |
| Tech debt | Zero markers | 22 TODOs | 3 TODOs |
| Test density | Best (0.82) | Middle (0.45) | Lowest (0.33) |
| Module size | Smallest (125 avg) | Middle (204 avg) | Largest (251 avg) |
| Error handling | Zod-first | Catch-heavy | Catch-based |
| Immutability | Best | Low | Low |
| Dependencies | Lightest (18) | Heaviest (103) | Middle (59) |
| Architecture | Most structured | Broad but implicit | Extension-driven |
| Feature breadth | Focused | Broadest | Broad |
| Maturity | Pre-launch | Shipped | Shipped |

Acolyte leads on every measurable quality axis while being the smallest and youngest codebase.
The quality compounds from commit one because the tool enforces verification on every change.
