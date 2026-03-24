# Benchmarks

Code quality metrics for Acolyte and other open-source AI agents, derived from **static source analysis** — no subjective scoring.

For feature and architecture comparisons, see [Comparison](./comparison.md).

All metrics extracted with [`scripts/benchmark.ts`](../scripts/benchmark.ts).

## Methodology

- **Source lines** = non-blank, non-comment lines of source code (SLOC)
- Test files, generated code, and files over **10k lines** are excluded
- Metrics normalized **per 1k source lines** where applicable
- Dependencies shown as **runtime + development** dependencies

## Closed systems

Several widely used coding agents are closed-source and cannot be analyzed with the same methodology.

| | Acolyte | Claude Code | Cursor | Copilot |
|---|---|---|---|---|
| Open-source | ✓ | ✗ | ✗ | ✗ |
| Self-hostable | ✓ | ✗ | ✗ | ✗ |
| Observable execution | ✓ | ✗ | ✗ | ✗ |

Claude Code, Cursor, and Copilot are included for context but excluded from code analysis benchmarks.

## Projects compared

| Project | Language | Description | Source lines | Files | Dependencies |
|---|---|---|---|---|---|
| **Acolyte** | TypeScript | CLI-first AI coding agent with lifecycle, guards, evaluators, and AST code tools | 25,284 | 193 | 12 + 6 |
| **Codex** | Rust | Terminal AI coding agent from OpenAI with multi-platform support | 535,898 | 1,175 | 233 + 58 |
| **Aider** | Python | AI pair programming in your terminal | 25,943 | 105 | 35 + 17 |
| **Plandex** | Go | AI coding agent for large multi-file tasks in the terminal | 74,573 | 333 | 54 + 0 |
| **OpenCode** | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 220,421 | 1,072 | 177 + 80 |
| **Pi** | TypeScript | Terminal coding agent harness with extensions | 103,306 | 406 | 50 + 19 |
| **Continue** | TypeScript | AI code assistant for VS Code and JetBrains | 231,575 | 1,462 | 186 + 164 |
| **Cline** | TypeScript | Autonomous AI coding agent for VS Code | 203,792 | 1,234 | 155 + 70 |
| **OpenHands** | Python | AI-driven software development platform | 125,103 | 714 | 83 + 7 |
| **Goose** | Rust | Extensible AI agent from Block with MCP integration | 128,126 | 336 | 142 + 17 |
| **OpenClaw** | TypeScript | Personal AI assistant with coding agent skill | 803,573 | 4,749 | 115 + 49 |

Each runtime dependency has a specific job — the AI SDK for model calls, Zod for validation, a custom React reconciler for the TUI, and tiktoken for token counting.

## Dependency surface area

Measures how much of a codebase depends on external packages.

External imports include package imports that resolve **outside the repository**.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| External imports / 1k LOC | 6.4 | 16.5 | 9.0 | 22.2 | 10.0 | 6.4 |
| Runtime dependencies | 12 | 177 | 50 | 155 | 186 | 115 |

_TypeScript projects only._

Lower values indicate a more self-contained codebase with fewer external dependencies.

Acolyte ties for the lowest external import density among TypeScript projects and has the fewest runtime dependencies by a wide margin.

## Input validation coverage

Measures how frequently data entering the system is validated.

Includes schema validation calls such as `safeParse`, `parse`, and `validate`.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| Schema validations / 1k LOC | 2.2 | 0.7 | 0.7 | 1.2 | 0.9 | 0.5 |
| `.safeParse()` calls | 1.0 | 0.1 | 0.0 | 0.0 | 0.1 | 0.0 |

_TypeScript projects only._

Higher values indicate stronger runtime validation of model outputs, RPC payloads, and configuration data.

Acolyte validates at a higher rate than every other project in the benchmark.

## Type safety — TypeScript

Per 1k source lines.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `as any` | 0.1 | 1.8 | 1.4 | 0.8 | 2.3 | 0.1 |
| `: any` annotations | 0.0 | 1.0 | 1.3 | 2.3 | 4.4 | 0.2 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 | 0.1 | 0.4 | 0.0 |
| Lint ignores | 0.1 | 0.0 | 0.0 | 0.1 | 0.2 | 0.1 |
| `: unknown` usage | 4.7 | 1.4 | 1.1 | 0.4 | 0.3 | 5.8 |

Acolyte has near-zero `any` usage. It uses `unknown` with explicit narrowing — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system.

## Type safety — Python, Rust, Go

Per 1k source lines.

| Metric | Aider | OpenHands | Goose | Codex | Plandex |
|---|---|---|---|---|---|
| `type: ignore` (Python) | 0.0 | 1.6 | — | — | — |
| `Any` usage (Python) | 0.1 | 3.4 | — | — | — |
| `cast()` calls (Python) | 0.0 | 0.4 | — | — | — |
| `unsafe` (Rust) | — | — | 0.0 | 0.9 | — |
| `.unwrap()` (Rust) | — | — | 11.7 | 2.7 | — |
| `.expect()` (Rust) | — | — | 1.4 | 8.6 | — |
| `any` / `interface{}` (Go) | — | — | — | — | 4.4 |
| `panic()` (Go) | — | — | — | — | 0.3 |
| `nolint` (Go) | — | — | — | — | 0.0 |

Aider shows minimal type escape hatches. Codex has much lower `.unwrap()` density than Goose but high `.expect()` density — errors are surfaced but rely on panicking assertions.


## Test quality

Measures test lines relative to source lines across all projects.

| Metric | Acolyte | Codex | Aider | Plandex | OpenCode | Pi | Continue | Cline | OpenHands | Goose | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Test files | 155 | 260 | 42 | 6 | 222 | 136 | 331 | 198 | 364 | 20 | 2,997 |
| Test lines | 21,516 | 108,359 | 12,427 | 2,517 | 45,822 | 39,923 | 82,509 | 49,490 | 147,973 | 7,504 | 658,266 |
| Test / source ratio | **0.85** | 0.20 | 0.48 | 0.03 | 0.21 | 0.39 | 0.36 | 0.24 | **1.18** | 0.06 | 0.82 |

Acolyte maintains a high test ratio because lifecycle phases, guards, and tools are independent modules with clean interfaces.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.ts`)
- performance (`*.perf.test.ts`)

## Module cohesion

Measures average file size, size distribution, and barrel file density.

| Metric | Acolyte | Codex | Aider | Plandex | OpenCode | Pi | Continue | Cline | OpenHands | Goose | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 131 | 456 | 247 | 224 | 206 | 254 | 158 | 165 | 175 | 381 | 169 |
| Files > 500 lines | 3 (2%) | 273 (23%) | 14 (13%) | 36 (11%) | 106 (10%) | 51 (13%) | 87 (6%) | 69 (6%) | 56 (8%) | 84 (25%) | 362 (8%) |
| Largest file | 762 | 9,962 | 2,486 | 2,455 | 5,036 | 4,648 | 3,229 | 4,809 | 2,055 | 2,559 | 4,222 |
| Barrel / index files | 1 | 61 | 5 | 0 | 51 | 26 | 73 | 47 | 86 | 45 | 108 |

Acolyte maintains the smallest average module size and fewest large files.

The `src/` layout keeps modules shallow with no re-exports and no circular dependencies.

## Error handling

Per 1k source lines.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `.safeParse()` calls | 1.0 | 0.1 | 0.0 | 0.0 | 0.1 | 0.0 |
| `try { ... }` blocks | 5.1 | 1.3 | 4.2 | 6.1 | 3.8 | 4.6 |
| `.catch()` calls | 0.5 | 2.3 | 0.4 | 1.1 | 0.3 | 1.0 |

_TypeScript projects only._

Acolyte validates boundaries with Zod `.safeParse()` at over **10× the rate** of most other projects.

RPC payloads, model responses, and configuration files are validated before entering the system.

## Key takeaways

Across the benchmarked projects, Acolyte demonstrates:

- Extremely low `any` usage and strong TypeScript safety
- The smallest modules and lowest large-file density
- The lightest dependency footprint
- High automated test coverage
- Clear lifecycle boundaries across independently testable modules

These characteristics reflect a deliberately small, strongly typed architecture — built so that lifecycle phases, guards, and tools behave predictably and can be independently verified.

## Summary

Consolidated comparison across all measured dimensions.

| Dimension | Acolyte | Codex | Aider | Plandex | OpenCode | Pi | Continue | Cline | OpenHands | Goose | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Type safety | High | Medium | High | Medium | Medium | Medium | Lower | Medium | Ignore-heavy | Panic-heavy | High |
| Test density | High (0.85) | Low (0.20) | Medium (0.48) | Low (0.03) | Low (0.21) | Medium (0.39) | Medium (0.36) | Low (0.24) | Highest (1.18) | Lowest (0.06) | High (0.82) |
| Module size | Smallest (131) | Large (456) | Medium (247) | Medium (224) | Medium (206) | Medium (254) | Medium (158) | Medium (165) | Medium (175) | Largest (381) | Medium (169) |
| Dependencies | Lightest (18) | Heavy (291) | Light (52) | Light (54) | Heavy (257) | Light (69) | Heavy (350) | Heavy (225) | Medium (90) | Heavy (159) | Heavy (164) |
| Maturity | New | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped |

Acolyte leads on type safety, module size, and dependency count while remaining the smallest codebase in the benchmark.

Updated 24 March 2026.
