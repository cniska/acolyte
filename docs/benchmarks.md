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
| **Acolyte** | TypeScript | Terminal coding agent with lifecycle, effects, and AST code tools | 24,133 | 194 | 12 + 6 |
| OpenCode | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 236,938 | 1,137 | 190 + 84 |
| Codex | Rust | Terminal AI coding agent from OpenAI | 447,519 | 1,118 | 244 + 57 |
| Crush | Go | Terminal AI coding agent from Charm with Bubble Tea TUI | 59,474 | 265 | 72 + 0 |
| Aider | Python | AI pair programming in your terminal | 25,943 | 105 | 35 + 17 |
| Goose | Rust | Extensible AI agent from Block with MCP integration | 133,088 | 340 | 150 + 19 |
| Qwen Code | TypeScript | Terminal AI coding agent from Alibaba | 232,262 | 1,070 | 91 + 86 |
| Plandex | Go | AI coding agent for large multi-file tasks in the terminal | 74,573 | 333 | 54 + 0 |
| Mistral Vibe | Python | Terminal AI coding agent from Mistral | 34,244 | 240 | 34 + 13 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| External imports / 1k LOC | 6.9 | 16.9 | 8.0 |
| Runtime dependencies | 12 | 190 | 91 |

_TypeScript projects only._

Acolyte has the lowest external import density and fewest runtime dependencies among TypeScript projects.

## Input validation coverage

Measures how frequently data entering the system is validated.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| Schema validations / 1k LOC | 2.2 | 0.8 | 0.6 |
| `.safeParse()` calls / 1k | 0.7 | 0.1 | 0.0 |

_TypeScript projects only._

Acolyte validates at a higher rate than every other project in the benchmark.

## TypeScript type safety

Per 1k source lines.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| `as any` | 0.1 | 1.7 | 0.1 |
| `: any` annotations | 0.0 | 0.9 | 0.3 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 |
| Lint ignores | 0.2 | 0.0 | 0.3 |
| `: unknown` usage | 4.9 | 1.8 | 2.3 |

Acolyte and Qwen Code have near-zero `any` usage. Acolyte uses `unknown` with explicit narrowing — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system.

## Cross-language type safety

Per 1k source lines.

| Metric | Aider | Mistral Vibe | Goose | Codex | Crush | Plandex |
|---|---|---|---|---|---|---|
| `type: ignore` (Python) | 0.0 | 0.1 | — | — | — | — |
| `Any` usage (Python) | 0.1 | 9.3 | — | — | — | — |
| `cast()` calls (Python) | 0.0 | 1.0 | — | — | — | — |
| `unsafe` (Rust) | — | — | 0.1 | 1.1 | — | — |
| `.unwrap()` (Rust) | — | — | 12.0 | 3.2 | — | — |
| `.expect()` (Rust) | — | — | 1.3 | 10.8 | — | — |
| `any` / `interface{}` (Go) | — | — | — | — | 3.5 | 4.4 |
| `panic()` (Go) | — | — | — | — | 0.2 | 0.3 |
| `nolint` (Go) | — | — | — | — | 0.2 | 0.0 |

Aider shows minimal type escape hatches. Mistral Vibe has high `Any` density. Codex has lower `.unwrap()` than Goose but high `.expect()` — errors are surfaced but rely on panicking assertions.

## Test quality

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Test files | 155 | 262 | 268 | 64 | 42 | 22 | 530 | 6 | 203 |
| Test lines | 20,260 | 61,678 | 126,596 | 13,040 | 12,427 | 7,970 | 227,757 | 2,517 | 42,370 |
| Ratio | 0.84 | 0.26 | 0.28 | 0.22 | 0.48 | 0.06 | 0.98 | 0.03 | 1.24 |

Acolyte maintains a high test ratio because lifecycle phases and tools are independent modules with clean interfaces.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.ts`)
- performance (`*.perf.test.ts`)

## Module cohesion

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 124 | 208 | 400 | 224 | 247 | 391 | 217 | 224 | 143 |
| Files > 500 lines | 2 (1%) | 118 (10%) | 230 (21%) | 25 (9%) | 14 (13%) | 88 (26%) | 114 (11%) | 36 (11%) | 8 (3%) |
| Largest file | 694 | 5,266 | 9,688 | 3,592 | 2,486 | 2,909 | 2,369 | 2,455 | 2,413 |
| Barrel / index files | 1 | 54 | 49 | 2 | 5 | 45 | 53 | 0 | 42 |

Acolyte maintains the smallest average module size and fewest large files.

## Error handling

Per 1k source lines.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| `.safeParse()` calls | 0.7 | 0.1 | 0.0 |
| `try { ... }` blocks | 5.8 | 1.3 | 5.0 |
| `.catch()` calls | 0.5 | 2.3 | 0.4 |

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
| Test density | High (0.84) | Low (0.26) | Low (0.28) | Low (0.22) | Medium (0.48) | Lowest (0.06) | High (0.98) | Low (0.03) | Highest (1.24) |
| Module size | Smallest (124) | Medium (208) | Large (400) | Medium (224) | Medium (247) | Largest (391) | Medium (217) | Medium (224) | Small (143) |
| Dependencies | Lightest (18) | Heavy (274) | Heavy (301) | Light (72) | Light (52) | Heavy (169) | Heavy (177) | Light (54) | Light (47) |
| First commit | Feb 2026 | Apr 2025 | Apr 2025 | May 2025 | May 2023 | Aug 2024 | Jun 2025 | Oct 2023 | Dec 2025 |

Acolyte leads on type safety, module size, and dependency count while remaining the smallest codebase in the benchmark.

Updated 6 April 2026.
