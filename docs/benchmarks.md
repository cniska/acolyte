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
| **Acolyte** | TypeScript | Terminal coding agent with lifecycle, effects, and AST code tools | 23,747 | 194 | 12 + 6 |
| **OpenCode** | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 233,164 | 1,122 | 180 + 82 |
| **Codex** | Rust | Terminal AI coding agent from OpenAI | 442,773 | 1,087 | 238 + 54 |
| **Crush** | Go | Terminal AI coding agent from Charm with Bubble Tea TUI | 47,615 | 224 | 68 + 0 |
| **Aider** | Python | AI pair programming in your terminal | 25,943 | 105 | 35 + 17 |
| **Goose** | Rust | Extensible AI agent from Block with MCP integration | 131,908 | 336 | 149 + 19 |
| **Cline** | TypeScript | Autonomous AI coding agent for VS Code | 204,605 | 1,239 | 155 + 70 |
| **Qwen Code** | TypeScript | Terminal AI coding agent from Alibaba | 228,822 | 1,058 | 91 + 86 |
| **OpenHands** | Python | AI-driven software development platform | 125,987 | 717 | 83 + 7 |
| **Continue** | TypeScript | AI code assistant for VS Code and JetBrains | 233,849 | 1,469 | 186 + 164 |
| **Plandex** | Go | AI coding agent for large multi-file tasks in the terminal | 74,573 | 333 | 54 + 0 |
| **Mistral Vibe** | Python | Terminal AI coding agent from Mistral | 31,072 | 223 | 34 + 13 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | OpenCode | Cline | Qwen Code | Continue |
|---|---|---|---|---|---|
| External imports / 1k LOC | 6.8 | 16.6 | 22.2 | 8.0 | 10.0 |
| Runtime dependencies | 12 | 180 | 155 | 91 | 186 |

_TypeScript projects only._

Acolyte has the lowest external import density and fewest runtime dependencies among TypeScript projects.

## Input validation coverage

Measures how frequently data entering the system is validated.

| Metric | Acolyte | OpenCode | Cline | Qwen Code | Continue |
|---|---|---|---|---|---|
| Schema validations / 1k LOC | 2.1 | 0.8 | 1.2 | 0.6 | 0.9 |
| `.safeParse()` calls / 1k | 0.8 | 0.1 | 0.0 | 0.0 | 0.1 |

_TypeScript projects only._

Acolyte validates at a higher rate than every other project in the benchmark.

## TypeScript type safety

Per 1k source lines.

| Metric | Acolyte | OpenCode | Cline | Qwen Code | Continue |
|---|---|---|---|---|---|
| `as any` | 0.1 | 1.7 | 0.8 | 0.1 | 2.4 |
| `: any` annotations | 0.0 | 1.0 | 2.3 | 0.3 | 4.4 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.1 | 0.0 | 0.3 |
| Lint ignores | 0.2 | 0.0 | 0.1 | 0.3 | 0.2 |
| `: unknown` usage | 4.8 | 1.8 | 0.4 | 2.3 | 0.3 |

Acolyte and Qwen Code have near-zero `any` usage. Acolyte uses `unknown` with explicit narrowing — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system.

## Cross-language type safety

Per 1k source lines.

| Metric | Aider | Mistral Vibe | OpenHands | Goose | Codex | Crush | Plandex |
|---|---|---|---|---|---|---|---|
| `type: ignore` (Python) | 0.0 | 0.1 | 1.6 | — | — | — | — |
| `Any` usage (Python) | 0.1 | 7.1 | 3.4 | — | — | — | — |
| `cast()` calls (Python) | 0.0 | 0.8 | 0.4 | — | — | — | — |
| `unsafe` (Rust) | — | — | — | 0.0 | 1.1 | — | — |
| `.unwrap()` (Rust) | — | — | — | 12.1 | 3.2 | — | — |
| `.expect()` (Rust) | — | — | — | 1.3 | 10.8 | — | — |
| `any` / `interface{}` (Go) | — | — | — | — | — | 3.7 | 4.4 |
| `panic()` (Go) | — | — | — | — | — | 0.2 | 0.3 |
| `nolint` (Go) | — | — | — | — | — | 0.2 | 0.0 |

Aider shows minimal type escape hatches. Mistral Vibe has high `Any` density. Codex has lower `.unwrap()` than Goose but high `.expect()` — errors are surfaced but rely on panicking assertions.

## Test quality

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Cline | Qwen Code | OpenHands | Continue | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Test files | 151 | 254 | 264 | 63 | 42 | 21 | 208 | 520 | 368 | 335 | 6 | 193 |
| Test lines | 20,328 | 57,911 | 124,863 | 12,713 | 12,427 | 7,631 | 50,977 | 225,661 | 150,494 | 83,887 | 2,517 | 40,073 |
| Ratio | 0.86 | 0.25 | 0.28 | 0.27 | 0.48 | 0.06 | 0.25 | 0.99 | 1.19 | 0.36 | 0.03 | 1.29 |

Acolyte maintains a high test ratio because lifecycle phases and tools are independent modules with clean interfaces.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.ts`)
- performance (`*.perf.test.ts`)

## Module cohesion

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Cline | Qwen Code | OpenHands | Continue | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 122 | 208 | 407 | 213 | 247 | 393 | 165 | 216 | 176 | 159 | 224 | 139 |
| Files > 500 lines | 2 (1%) | 114 (10%) | 229 (21%) | 18 (8%) | 14 (13%) | 88 (26%) | 69 (6%) | 112 (11%) | 57 (8%) | 92 (6%) | 36 (11%) | 7 (3%) |
| Largest file | 762 | 5,166 | 9,394 | 3,620 | 2,486 | 2,898 | 4,833 | 2,369 | 2,063 | 3,274 | 2,455 | 2,268 |
| Barrel / index files | 1 | 53 | 50 | 2 | 5 | 45 | 47 | 52 | 86 | 73 | 0 | 39 |

Acolyte maintains the smallest average module size and fewest large files.

## Error handling

Per 1k source lines.

| Metric | Acolyte | OpenCode | Cline | Qwen Code | Continue |
|---|---|---|---|---|---|
| `.safeParse()` calls | 0.8 | 0.1 | 0.0 | 0.0 | 0.1 |
| `try { ... }` blocks | 5.5 | 1.3 | 6.1 | 5.0 | 3.8 |
| `.catch()` calls | 0.5 | 2.2 | 1.1 | 0.3 | 0.3 |

_TypeScript projects only._

Acolyte validates boundaries with Zod `.safeParse()` at a higher rate than other projects. RPC payloads, model responses, and configuration files are validated before entering the system.

## Key takeaways

Across the benchmarked projects, Acolyte demonstrates:

- Extremely low `any` usage and strong TypeScript safety
- The smallest modules and lowest large-file density
- The lightest dependency footprint
- High automated test coverage
- Clear lifecycle boundaries across independently testable modules

These characteristics reflect a deliberately small, strongly typed architecture — built so that lifecycle phases and tools behave predictably and can be independently verified.

## Summary

| Dimension | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Cline | Qwen Code | OpenHands | Continue | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Type safety | High | Medium | Medium | Medium | High | Panic-heavy | Medium | High | Ignore-heavy | Lower | Medium | Any-heavy |
| Test density | High (0.86) | Low (0.25) | Low (0.28) | Low (0.27) | Medium (0.48) | Lowest (0.06) | Low (0.25) | High (0.99) | Highest (1.19) | Medium (0.36) | Low (0.03) | Highest (1.29) |
| Module size | Smallest (122) | Medium (208) | Large (407) | Medium (213) | Medium (247) | Largest (393) | Medium (165) | Medium (216) | Medium (176) | Medium (159) | Medium (224) | Small (139) |
| Dependencies | Lightest (18) | Heavy (262) | Heavy (292) | Light (68) | Light (52) | Heavy (168) | Heavy (225) | Heavy (177) | Medium (90) | Heavy (350) | Light (54) | Light (47) |
| First commit | Feb 2026 | Apr 2025 | Apr 2025 | May 2025 | May 2023 | Aug 2024 | Jul 2024 | Jun 2025 | Mar 2024 | May 2023 | Oct 2023 | Dec 2025 |

Acolyte leads on type safety, module size, and dependency count while remaining the smallest codebase in the benchmark.

Updated 1 April 2026.
