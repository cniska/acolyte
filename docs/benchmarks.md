# Code Quality Benchmarks

Measured comparisons of Acolyte against prominent open-source AI coding agents.
All metrics are from source code analysis — no opinions, just counts.

## Projects Compared

| Project | Language | Description | Source Lines | Files | Dependencies |
|---|---|---|---|---|---|
| **Acolyte** | TypeScript | CLI-first AI coding agent with lifecycle, guards, and evaluators | 19,121 | 146 | 18 |
| **Aider** | Python | AI pair programming in your terminal | 25,833 | 105 | 480 |
| **OpenCode** | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 60,655 | 297 | 103 |
| **Pi** | TypeScript | Terminal coding agent harness with extensions | 97,279 | 387 | 59 |
| **Goose** | Rust | Extensible AI agent from Block with MCP integration | 118,573 | 337 | 65 |
| **OpenHands** | Python | AI-driven software development platform | 126,855 | 807 | 163 |
| **Continue** | TypeScript | AI code assistant for VS Code and JetBrains | 225,696 | 1,441 | 538 |
| **Cline** | TypeScript | Autonomous AI coding agent for VS Code | 532,192 | 1,212 | 139 |
| **OpenClaw** | TypeScript | Personal AI assistant with coding agent skill | 615,595 | 3,516 | 153 |

Source lines exclude test files and generated code. Dependencies are runtime + dev combined.

## Type Safety (TypeScript projects, per 1k source lines)

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `as any` | 0.05 | 0.7 | 1.3 | 0.3 | 2.2 | 0.1 |
| `: any` annotations | 0.0 | 1.4 | 1.2 | 0.9 | 4.1 | 0.3 |
| Non-null `!.` assertions | 0.0 | 0.6 | 0.2 | 0.1 | 0.4 | 0.05 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.3 | 0.0 | 0.05 | 0.4 | 0.003 |
| `: unknown` usage | 4.4 | 0.7 | 0.9 | 0.1 | 0.2 | 5.3 |

Acolyte has **1 total `any`** (an FFI boundary for ast-grep). It uses `unknown` with explicit narrowing at 4–50x the rate of most other projects. OpenClaw also favors `unknown` heavily. Continue has the highest `any` density.

## Type Safety (Python / Rust projects, per 1k source lines)

| Metric | Aider | OpenHands |
|---|---|---|
| `type: ignore` | 0.04 | 1.6 |
| `Any` type usage | 0.0 | 1.9 |
| `cast()` calls | 0.0 | 0.3 |

| Metric | Goose |
|---|---|
| `unsafe` | 0.008 |
| `.unwrap()` | 11.8 |
| `.expect()` | 1.6 |

Aider is nearly zero on type escape hatches. Goose has a high `.unwrap()` density — potential panic sites at 11.8 per 1k lines.

## Tech Debt (per 1k source lines)

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| TODO / FIXME / HACK | 0.0 | 0.6 | 0.4 | 0.03 | 0.7 | 0.6 | 1.4 | 0.5 | 0.1 |
| Comment lines | 3.3 | 55.1 | 19.1 | 54.3 | 42.3 | 60.4 | 42.9 | 20.4 | 14.5 |

Zero tech debt markers. Low comment density reflects self-documenting code with external docs.

## Test Quality

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Test files | 90 | 42 | 87 + 42 e2e | 105 | — | 350 | 331 | 162 | 2,021 |
| Test lines | 13,750 | 12,368 | 32,056 | 31,833 | 4,614 | 137,229 | 81,526 | 43,425 | 409,009 |
| Test / source ratio | **0.72** | 0.48 | 0.53 | 0.33 | 0.04 | **1.08** | 0.36 | 0.08 | 0.66 |

Acolyte maintains a structured test taxonomy with four dedicated types: unit (`*.test.ts`), integration (`*.int.test.ts`), TUI visual regression (`*.tui.test.ts`), and performance (`*.perf.test.ts`). OpenHands leads on raw ratio. Goose and Cline have notably low test density.

## Module Cohesion

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 130 | 246 | 204 | 251 | 369 | 157 | 156 | 439 | 175 |
| Files > 500 lines | 3 (2%) | 14 (13%) | 27 (9%) | 48 (12%) | 75 (22%) | 54 (7%) | 87 (6%) | 68 (6%) | 280 (8%) |
| Largest file | 1,181 | 2,485 | 2,248 | 4,401 | 2,238 | 1,711 | 3,228 | 4,561 | 2,106 |
| Barrel / index files | 0 | 0 | 29 | 26 | — | 0 | 12 | 10 | 29 |

Acolyte has the smallest average file size and zero barrel files. Flat `src/` layout with small, focused modules.

## Error Handling (TypeScript projects, per 1k source lines)

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `.safeParse()` calls | 1.4 | 0.2 | 0.0 | 0.008 | 0.06 | 0.01 |
| `try { ... }` blocks | 7.5 | 2.1 | 4.1 | 2.3 | 4.0 | 6.2 |
| `.catch()` calls | 0.5 | 4.3 | 0.3 | 0.4 | 0.3 | 1.0 |

Acolyte validates at boundaries with Zod `.safeParse()` at 7–175x the rate of other projects rather than relying on exception-driven error handling.

## Summary

| Dimension | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|
| Type safety | Best | Clean | Weak | Mid | Unwrap-heavy | Type-ignore-heavy | Weakest | Mid | Good |
| Tech debt | Zero | Low | Mid | Low | Mid | Mid | Highest | Mid | Low |
| Test density | High (0.72) | Mid (0.48) | Mid (0.53) | Low (0.33) | Lowest (0.04) | Highest (1.08) | Low (0.36) | Low (0.08) | High (0.66) |
| Module size | Smallest (130) | Mid (246) | Mid (204) | Large (251) | Largest (369) | Mid (157) | Mid (156) | Large (439) | Mid (175) |
| Dependencies | Lightest (18) | Heaviest (480) | Heavy (103) | Mid (59) | Light (65) | Heavy (163) | Heavy (538) | Heavy (139) | Heavy (153) |
| Maturity | Pre-launch | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped |

Acolyte leads on type safety, tech debt, module size, and dependency count while being the smallest codebase. The quality compounds from commit one because the tool enforces verification on every change.
