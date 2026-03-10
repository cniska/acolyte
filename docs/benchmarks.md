# Code Quality Benchmarks

Measured comparisons of Acolyte against prominent open-source AI coding agents.
All metrics are from source code analysis — no opinions, just counts.

Acolyte metrics extracted with [`scripts/benchmark.ts`](../scripts/benchmark.ts), others with [`scripts/benchmark-others.sh`](../scripts/benchmark-others.sh).

## Projects Compared

| Project | Language | Description | Source Lines | Files | Dependencies |
|---|---|---|---|---|---|
| **Acolyte** | TypeScript | CLI-first AI coding agent with lifecycle, guards, and evaluators | 18,005 | 141 | 12 + 5 |
| **Aider** | Python | AI pair programming in your terminal | 25,880 | 106 | 480 + 313 |
| **OpenCode** | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 207,748 | 1,042 | 171 + 76 |
| **Pi** | TypeScript | Terminal coding agent harness with extensions | 112,692 | 399 | 50 + 19 |
| **Goose** | Rust | Extensible AI agent from Block with MCP integration | 117,432 | 319 | 143 + 17 |
| **OpenHands** | Python | AI-driven software development platform | 120,856 | 699 | 163 |
| **Continue** | TypeScript | AI code assistant for VS Code and JetBrains | 229,431 | 1,458 | 186 + 164 |
| **Cline** | TypeScript | Autonomous AI coding agent for VS Code | 533,915 | 1,219 | 155 + 69 |
| **OpenClaw** | TypeScript | Personal AI assistant with coding agent skill | 628,159 | 3,551 | 112 + 46 |

Source lines exclude test files and generated code. Dependencies shown as runtime + dev.

Acolyte ships with 12 runtime dependencies because the daemon owns the stack — no framework, no ORM, no bundler. The AI SDK handles model calls, Zod handles validation, Ink handles the TUI. Everything else is owned code.

## Type Safety (TypeScript projects, per 1k source lines)

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `as any` | 0.06 | 1.5 | 1.2 | 0.3 | 2.3 | 0.1 |
| `: any` annotations | 0.0 | 1.0 | 1.1 | 0.9 | 4.2 | 0.2 |
| Non-null `!.` assertions | 0.0 | — | — | — | — | — |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 | 0.1 | 0.4 | 0.0 |
| Lint ignores (`biome-ignore` / `eslint-disable`) | 0.1 | 0.0 | 0.0 | 0.0 | 0.2 | 0.2 |
| `: unknown` usage | 4.6 | 1.4 | 0.8 | 0.1 | 0.3 | 5.3 |

Acolyte has **1 total `any`** (an FFI boundary for ast-grep). It uses `unknown` with explicit narrowing at 3-45x the rate of most other projects — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system. OpenClaw also favors `unknown` heavily. Continue has the highest `any` density.

## Type Safety (Python / Rust projects, per 1k source lines)

| Metric | Aider | OpenHands |
|---|---|---|
| `type: ignore` | 0.0 | 1.7 |
| `Any` type usage | 0.1 | 3.1 |
| `cast()` calls | 0.0 | 0.3 |

| Metric | Goose |
|---|---|
| `unsafe` | 0.1 |
| `.unwrap()` | 11.2 |
| `.expect()` | 1.3 |

Aider is nearly zero on type escape hatches. Goose has a high `.unwrap()` density — potential panic sites at 11.2 per 1k lines.

## Tech Debt (per 1k source lines)

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| TODO / FIXME / HACK | 0.0 | 0.3 | 0.4 | 0.0 | 0.2 | 0.5 | 0.8 | 0.2 | 0.0 |
| Comment lines | 3.9 | 55.2 | 10.0 | 47.5 | 40.6 | 60.6 | 42.9 | 20.5 | 14.5 |

Zero tech debt markers. The guard and evaluator system catches issues during generation — problems that would become TODOs in other projects get fixed before they're committed. Low comment density reflects self-documenting code backed by 25 external docs.

## Test Quality

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Test files | 97 | 41 | 186 | 108 | 17 | 348 | 332 | 165 | 2,076 |
| Test lines | 16,129 | 12,321 | 37,040 | 32,572 | 4,726 | 137,765 | 82,421 | 44,423 | 431,818 |
| Test / source ratio | **0.90** | 0.48 | 0.18 | 0.29 | 0.04 | **1.14** | 0.36 | 0.08 | 0.69 |

Acolyte maintains a 0.90 test/source ratio because the lifecycle phases, guards, and tools are each independent modules with clean interfaces — testable by design, not by retrofit. Four dedicated test types: unit (`*.test.ts`), integration (`*.int.test.ts`), TUI visual regression (`*.tui.test.ts`), and performance (`*.perf.test.ts`). OpenHands leads on raw ratio. Goose and Cline have notably low test density.

## Module Cohesion

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 128 | 244 | 199 | 283 | 368 | 172 | 157 | 438 | 176 |
| Files > 500 lines | 3 (2%) | 14 (13%) | 103 (9%) | 50 (12%) | 75 (23%) | 54 (7%) | 87 (5%) | 69 (5%) | 291 (8%) |
| Largest file | 1,182 | 2,485 | 4,989 | 13,353 | 2,289 | 1,704 | 3,228 | 4,573 | 2,242 |
| Barrel / index files | 0 | 5 | 52 | 26 | 43 | 85 | 73 | 47 | 76 |

Acolyte has the smallest average file size, fewest large files, and zero barrel files. The flat `src/` layout keeps every module at the same depth — no barrel re-exports, no deep nesting, no circular dependency chains.

## Error Handling (TypeScript projects, per 1k source lines)

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `.safeParse()` calls | 1.5 | 0.1 | 0.0 | 0.0 | 0.1 | 0.0 |
| `try { ... }` blocks | 6.6 | 1.3 | 3.7 | 2.3 | 3.8 | 4.9 |
| `.catch()` calls | 0.5 | 2.2 | 0.3 | 0.4 | 0.3 | 1.0 |

Acolyte validates at boundaries with Zod `.safeParse()` at 16x+ the rate of other projects. Every RPC payload, model response, and config file is validated before entering the system — errors surface as structured results, not uncaught exceptions.

## GitHub Popularity

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Stars | — | 41.5k | 117k | 20.5k | 32.5k | 68.6k | 31.7k | 58.7k | 268k |
| Forks | — | 3,974 | 11,906 | 2,134 | 2,976 | 8,571 | 4,227 | 5,902 | 51,229 |
| Open issues | — | 1,410 | 6,414 | 21 | 391 | 359 | 1,140 | 778 | 12,607 |
| Initial commit | 2026-02-20 | 2023-05-09 | 2025-04-30 | 2025-08-09 | 2024-08-23 | 2024-03-13 | 2023-05-24 | 2024-07-06 | 2025-11-24 |

Acolyte's first commit is from 20 February 2026 (pre-launch, no public repo yet). Stars reflect community adoption, not code quality. OpenClaw and OpenCode dominate on stars — OpenClaw at 268k is the #11 most starred repository on all of GitHub. Pi has the fewest open issues by a wide margin. Aider and Continue are the oldest projects.

## Summary

| Dimension | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Type safety | Best | Clean | Weak | Mid | Unwrap-heavy | Type-ignore-heavy | Weakest | Mid | Good |
| Tech debt | Zero | Low | Low | Zero | Low | Mid | Highest | Low | Zero |
| Test density | High (0.90) | Mid (0.48) | Low (0.18) | Low (0.29) | Lowest (0.04) | Highest (1.13) | Mid (0.36) | Low (0.08) | High (0.68) |
| Module size | Smallest (126) | Mid (244) | Mid (199) | Large (282) | Largest (368) | Mid (172) | Mid (157) | Large (437) | Mid (176) |
| Dependencies | Lightest (17) | Heaviest (793) | Heavy (247) | Light (69) | Heavy (160) | Heavy (163) | Heavy (350) | Heavy (224) | Heavy (158) |
| Maturity | Pre-launch | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped |

Acolyte leads on type safety, tech debt, module size, and dependency count while being the smallest codebase. The quality compounds from commit one because the tool enforces verification on every change.

---

Canonical copy: https://gist.github.com/crisu83/fb4a55d88fc0e9c9e9b5f6615d1c8673
