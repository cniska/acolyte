# Benchmarks

Code quality metrics for Acolyte and other open-source AI agents, derived from **static source analysis** — no subjective scoring.

For feature and architecture comparisons, see [Comparison](./comparison.md).

All metrics extracted with [`scripts/benchmark.ts`](../scripts/benchmark.ts).

## Methodology

- **Source lines** = total lines of source code (including blanks and comments)
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
| **Acolyte** | TypeScript | Terminal coding agent with lifecycle, effects, and AST code tools | 23,216 | 188 | 12 + 6 |
| OpenCode | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 234,226 | 1,126 | 183 + 83 |
| Codex | Rust | Terminal AI coding agent from OpenAI | 444,998 | 1,105 | 240 + 54 |
| Crush | Go | Terminal AI coding agent from Charm with Bubble Tea TUI | 47,576 | 224 | 68 + 0 |
| Aider | Python | AI pair programming in your terminal | 25,943 | 105 | 35 + 17 |
| Goose | Rust | Extensible AI agent from Block with MCP integration | 132,016 | 336 | 149 + 19 |
| Qwen Code | TypeScript | Terminal AI coding agent from Alibaba | 228,838 | 1,058 | 91 + 86 |
| Plandex | Go | AI coding agent for large multi-file tasks in the terminal | 74,573 | 333 | 54 + 0 |
| Mistral Vibe | Python | Terminal AI coding agent from Mistral | 31,323 | 226 | 34 + 13 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| External imports / 1k LOC | 6.9 | 16.8 | 8.0 |
| Runtime dependencies | 12 | 183 | 91 |

_TypeScript projects only._

Acolyte has the lowest external import density and fewest runtime dependencies among TypeScript projects.

## Input validation coverage

Measures how frequently data entering the system is validated.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| Schema validations / 1k LOC | 2.2 | 0.8 | 0.6 |
| `.safeParse()` calls / 1k | 0.8 | 0.1 | 0.0 |

_TypeScript projects only._

Acolyte validates at a higher rate than every other project in the benchmark.

## TypeScript type safety

Per 1k source lines.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| `as any` | 0.1 | 1.7 | 0.1 |
| `: any` annotations | 0.0 | 1.0 | 0.3 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 |
| Lint ignores | 0.2 | 0.0 | 0.3 |
| `: unknown` usage | 5.1 | 1.8 | 2.3 |

Acolyte and Qwen Code have near-zero `any` usage. Acolyte uses `unknown` with explicit narrowing — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system.

## Cross-language type safety

Per 1k source lines.

| Metric | Aider | Mistral Vibe | Goose | Codex | Crush | Plandex |
|---|---|---|---|---|---|---|
| `type: ignore` (Python) | 0.0 | 0.1 | — | — | — | — |
| `Any` usage (Python) | 0.1 | 7.1 | — | — | — | — |
| `cast()` calls (Python) | 0.0 | 0.8 | — | — | — | — |
| `unsafe` (Rust) | — | — | 0.0 | 1.1 | — | — |
| `.unwrap()` (Rust) | — | — | 12.1 | 3.2 | — | — |
| `.expect()` (Rust) | — | — | 1.3 | 10.8 | — | — |
| `any` / `interface{}` (Go) | — | — | — | — | 3.7 | 4.4 |
| `panic()` (Go) | — | — | — | — | 0.2 | 0.3 |
| `nolint` (Go) | — | — | — | — | 0.2 | 0.0 |

Aider shows minimal type escape hatches. Mistral Vibe has high `Any` density. Codex has lower `.unwrap()` than Goose but high `.expect()` — errors are surfaced but rely on panicking assertions.

## Test quality

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Test files | 150 | 257 | 267 | 63 | 42 | 21 | 520 | 6 | 193 |
| Test lines | 19,564 | 60,382 | 125,228 | 12,713 | 12,427 | 7,631 | 225,681 | 2,517 | 40,211 |
| Ratio | 0.84 | 0.26 | 0.28 | 0.27 | 0.48 | 0.06 | 0.99 | 0.03 | 1.28 |

Acolyte maintains a high test ratio because lifecycle phases and tools are independent modules with clean interfaces.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.ts`)
- performance (`*.perf.test.ts`)

## Module cohesion

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 123 | 208 | 403 | 212 | 247 | 393 | 216 | 224 | 139 |
| Files > 500 lines | 2 (1%) | 116 (10%) | 230 (21%) | 18 (8%) | 14 (13%) | 88 (26%) | 112 (11%) | 36 (11%) | 7 (3%) |
| Largest file | 694 | 5,166 | 9,404 | 3,620 | 2,486 | 2,909 | 2,369 | 2,455 | 2,194 |
| Barrel / index files | 1 | 53 | 50 | 2 | 5 | 45 | 52 | 0 | 40 |

Acolyte maintains the smallest average module size and fewest large files.

## Error handling

Per 1k source lines.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| `.safeParse()` calls | 0.8 | 0.1 | 0.0 |
| `try { ... }` blocks | 5.8 | 1.3 | 5.0 |
| `.catch()` calls | 0.6 | 2.2 | 0.3 |

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

| Dimension | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Type safety | High | Medium | Medium | Medium | High | Panic-heavy | High | Medium | Any-heavy |
| Test density | High (0.84) | Low (0.26) | Low (0.28) | Low (0.27) | Medium (0.48) | Lowest (0.06) | High (0.99) | Low (0.03) | Highest (1.28) |
| Module size | Smallest (123) | Medium (208) | Large (403) | Medium (212) | Medium (247) | Largest (393) | Medium (216) | Medium (224) | Small (139) |
| Dependencies | Lightest (18) | Heavy (266) | Heavy (294) | Light (68) | Light (52) | Heavy (168) | Heavy (177) | Light (54) | Light (47) |
| First commit | Feb 2026 | Apr 2025 | Apr 2025 | May 2025 | May 2023 | Aug 2024 | Jun 2025 | Oct 2023 | Dec 2025 |

Acolyte leads on type safety, module size, and dependency count while remaining the smallest codebase in the benchmark.

Updated 2 April 2026.
