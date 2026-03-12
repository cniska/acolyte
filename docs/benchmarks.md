# Code Quality Benchmarks

Measured comparisons of Acolyte against prominent open-source AI coding agents.
All metrics are from source code analysis — no opinions, just counts.

All metrics extracted with [`scripts/benchmark.ts`](../scripts/benchmark.ts). Files over 10k lines are excluded (generated/embedded data). Dependencies are direct only.

## Projects Compared

| Project | Language | Description | Source Lines | Files | Dependencies |
|---|---|---|---|---|---|
| **Acolyte** | TypeScript | CLI-first AI coding agent with lifecycle, guards, and evaluators | 18,655 | 150 | 13 + 5 |
| **Aider** | Python | AI pair programming in your terminal | 25,938 | 105 | 35 + 17 |
| **OpenCode** | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 212,218 | 1,047 | 173 + 79 |
| **Pi** | TypeScript | Terminal coding agent harness with extensions | 99,016 | 394 | 50 + 19 |
| **Goose** | Rust | Extensible AI agent from Block with MCP integration | 121,672 | 326 | 139 + 15 |
| **OpenHands** | Python | AI-driven software development platform | 121,981 | 702 | 82 + 7 |
| **Continue** | TypeScript | AI code assistant for VS Code and JetBrains | 231,116 | 1,459 | 186 + 164 |
| **Cline** | TypeScript | Autonomous AI coding agent for VS Code | 201,715 | 1,219 | 155 + 69 |
| **OpenClaw** | TypeScript | Personal AI assistant with coding agent skill | 671,014 | 3,713 | 108 + 47 |

Source lines exclude test files, generated code, and files over 10k lines. Dependencies shown as direct runtime + dev.

Acolyte ships with 13 runtime dependencies because the daemon owns the stack — no framework, no ORM, no bundler. The AI SDK handles model calls, Zod handles validation, Ink handles the TUI, tiktoken handles token counting. Everything else is owned code.

## Type Safety (TypeScript projects, per 1k source lines)

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `as any` | 0.1 | 1.8 | 1.4 | 0.8 | 2.3 | 0.1 |
| `: any` annotations | 0.0 | 1.1 | 1.4 | 2.3 | 4.4 | 0.2 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 | 0.1 | 0.4 | 0.0 |
| Lint ignores (`biome-ignore` / `eslint-disable`) | 0.1 | 0.0 | 0.0 | 0.1 | 0.2 | 0.1 |
| `: unknown` usage | 3.9 | 1.5 | 1.0 | 0.4 | 0.3 | 5.6 |

Acolyte has **1 total `any`** (an FFI boundary for ast-grep). It uses `unknown` with explicit narrowing at high rates — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system. OpenClaw also favors `unknown` heavily. Continue has the highest `any` density.

## Type Safety (Python / Rust projects, per 1k source lines)

| Metric | Aider | OpenHands |
|---|---|---|
| `type: ignore` | 0.0 | 1.7 |
| `Any` type usage | 0.1 | 3.4 |
| `cast()` calls | 0.0 | 0.3 |

| Metric | Goose |
|---|---|
| `unsafe` | 0.0 |
| `.unwrap()` | 12.0 |
| `.expect()` | 1.4 |

Aider is nearly zero on type escape hatches. Goose has a high `.unwrap()` density — potential panic sites at 12.0 per 1k lines.

## Tech Debt (per 1k source lines)

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| TODO / FIXME / HACK | 0.0 | 0.3 | 0.3 | 0.0 | 0.2 | 0.5 | 0.8 | 0.7 | 0.0 |
| Comment lines | 5.0 | 54.9 | 9.8 | 53.2 | 39.6 | 60.2 | 42.6 | 54.0 | 14.2 |

Zero tech debt markers. The guard and evaluator system catches issues during generation — problems that would become TODOs in other projects get fixed before they're committed. Low comment density reflects self-documenting code backed by external docs.

## Test Quality

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Test files | 120 | 42 | 200 | 111 | 19 | 350 | 331 | 176 | 2,305 |
| Test lines | 14,483 | 12,410 | 40,270 | 34,436 | 5,314 | 140,844 | 82,475 | 45,762 | 495,081 |
| Test / source ratio | **0.78** | 0.48 | 0.19 | 0.35 | 0.04 | **1.15** | 0.36 | 0.23 | 0.74 |

Acolyte maintains a 0.78 test/source ratio because the lifecycle phases, guards, and tools are each independent modules with clean interfaces — testable by design, not by retrofit. Four dedicated test types: unit (`*.test.ts`), integration (`*.int.test.ts`), TUI visual regression (`*.tui.test.ts`), and performance (`*.perf.test.ts`). OpenHands leads on raw ratio. Goose has notably low test density.

## Module Cohesion

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 124 | 247 | 203 | 251 | 373 | 174 | 158 | 165 | 181 |
| Files > 500 lines | 3 (2%) | 14 (13%) | 103 (10%) | 50 (13%) | 79 (24%) | 55 (8%) | 87 (6%) | 68 (6%) | 311 (8%) |
| Largest file | 568 | 2,486 | 4,960 | 4,465 | 2,504 | 1,711 | 3,229 | 4,601 | 2,805 |
| Barrel / index files | 0 | 5 | 51 | 26 | 44 | 85 | 73 | 47 | 76 |

Acolyte has the smallest average file size, fewest large files, and zero barrel files. The flat `src/` layout keeps every module at the same depth — no barrel re-exports, no deep nesting, no circular dependency chains.

## Error Handling (TypeScript projects, per 1k source lines)

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `.safeParse()` calls | 1.3 | 0.1 | 0.0 | 0.0 | 0.1 | 0.0 |
| `try { ... }` blocks | 6.1 | 1.3 | 4.1 | 6.1 | 3.8 | 4.8 |
| `.catch()` calls | 0.6 | 2.3 | 0.3 | 1.1 | 0.3 | 1.0 |

Acolyte validates at boundaries with Zod `.safeParse()` at 13x+ the rate of most other projects. Every RPC payload, model response, and config file is validated before entering the system — errors surface as structured results, not uncaught exceptions.

## Summary

| Dimension | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Type safety | Best | Clean | Weak | Mid | Unwrap-heavy | Type-ignore-heavy | Weakest | Mid | Good |
| Tech debt | Zero | Low | Low | Zero | Low | Mid | Highest | Mid | Zero |
| Test density | High (0.78) | Mid (0.48) | Low (0.19) | Mid (0.35) | Lowest (0.04) | Highest (1.15) | Mid (0.36) | Low (0.23) | High (0.74) |
| Module size | Smallest (124) | Mid (247) | Mid (203) | Mid (251) | Largest (373) | Mid (174) | Mid (158) | Mid (165) | Mid (181) |
| Dependencies | Lightest (18) | Light (52) | Heavy (252) | Light (69) | Heavy (154) | Mid (89) | Heavy (350) | Heavy (224) | Heavy (155) |
| Maturity | New | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped |

Acolyte leads on type safety, tech debt, module size, and dependency count while being the smallest codebase.

---

Last updated: March 2026. Metrics from source code analysis at time of measurement.
