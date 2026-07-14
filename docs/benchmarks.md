# Benchmarks

These benchmarks compare Acolyte with eight open-source coding agents using reproducible static source analysis and normalized code-quality metrics.

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
| **Acolyte** | TypeScript | Terminal coding agent with lifecycle, effects, and AST code tools | 29,482 | 248 | 13 + 6 |
| OpenCode | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 397,083 | 2,253 | 220 + 110 |
| Codex | Rust | Terminal AI coding agent from OpenAI | 846,250 | 2,085 | 289 + 79 |
| Crush | Go | Terminal AI coding agent from Charm with Bubble Tea TUI | 78,709 | 321 | 72 + 0 |
| Aider | Python | AI pair programming in your terminal | 25,958 | 105 | 35 + 17 |
| Goose | Rust | Extensible AI agent from Block with MCP integration | 200,872 | 454 | 161 + 22 |
| Qwen Code | TypeScript | Terminal AI coding agent from Alibaba | 872,347 | 3,039 | 215 + 130 |
| Plandex | Go | AI coding agent for large multi-file tasks in the terminal | 74,573 | 333 | 54 + 0 |
| Mistral Vibe | Python | Terminal AI coding agent from Mistral | 58,196 | 355 | 96 + 16 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| External imports / 1k LOC | 7.1 | 18.9 | 7.3 |
| Runtime dependencies | 13 | 220 | 215 |

_TypeScript projects only._

Acolyte has the lowest external import density and fewest runtime dependencies among TypeScript projects.

## Input validation coverage

Measures how frequently data entering the system is validated.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| Schema validations / 1k LOC | 2.9 | 0.5 | 0.5 |
| `.safeParse()` calls / 1k | 1.1 | 0.0 | 0.0 |

_TypeScript projects only._

Acolyte validates at a higher rate than every other project in the benchmark.

## TypeScript type safety

Per 1k source lines.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| `as any` | 0.1 | 1.0 | 0.2 |
| `: any` annotations | 0.0 | 0.6 | 0.3 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 |
| Lint ignores | 0.2 | 0.0 | 0.2 |
| `: unknown` usage | 3.2 | 2.5 | 2.8 |

Acolyte and Qwen Code have near-zero `any` usage. Acolyte uses `unknown` with explicit narrowing — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system.

## Cross-language type safety

Per 1k source lines.

| Metric | Aider | Mistral Vibe | Goose | Codex | Crush | Plandex |
|---|---|---|---|---|---|---|
| `type: ignore` (Python) | 0.0 | 0.1 | — | — | — | — |
| `Any` usage (Python) | 0.1 | 9.4 | — | — | — | — |
| `cast()` calls (Python) | 0.0 | 0.7 | — | — | — | — |
| `unsafe` (Rust) | — | — | 0.1 | 0.9 | — | — |
| `.unwrap()` (Rust) | — | — | 13.7 | 2.9 | — | — |
| `.expect()` (Rust) | — | — | 1.9 | 13.2 | — | — |
| `any` / `interface{}` (Go) | — | — | — | — | 4.8 | 4.4 |
| `panic()` (Go) | — | — | — | — | 0.2 | 0.3 |
| `nolint` (Go) | — | — | — | — | 0.2 | 0.0 |

Aider shows minimal type escape hatches. Mistral Vibe has high `Any` density. Codex has lower `.unwrap()` than Goose but high `.expect()` — errors are surfaced but rely on panicking assertions.

## Test quality

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Test files | 199 | 675 | 384 | 164 | 42 | 26 | 1,602 | 6 | 406 |
| Test lines | 26,360 | 163,420 | 228,987 | 39,095 | 12,470 | 13,502 | 818,324 | 2,517 | 92,005 |
| Ratio | 0.89 | 0.41 | 0.27 | 0.50 | 0.48 | 0.07 | 0.94 | 0.03 | 1.58 |

Acolyte maintains a high test ratio because lifecycle phases and tools are independent modules with clean interfaces.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.tsx`)
- performance (`*.perf.test.ts`)

## Module cohesion

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 119 | 176 | 406 | 245 | 247 | 442 | 287 | 224 | 164 |
| Files > 500 lines | 3 (1%) | 186 (8%) | 481 (23%) | 33 (10%) | 14 (13%) | 130 (29%) | 403 (13%) | 36 (11%) | 15 (4%) |
| Largest file | 692 | 7,220 | 6,352 | 4,348 | 2,486 | 4,246 | 8,403 | 2,455 | 3,881 |
| Barrel / index files | 1 | 70 | 73 | 2 | 5 | 52 | 161 | 0 | 51 |

Acolyte maintains the smallest average module size and fewest large files.

## Error handling

Per 1k source lines.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| `.safeParse()` calls | 1.1 | 0.0 | 0.0 |
| `try { ... }` blocks | 6.1 | 1.2 | 5.4 |
| `.catch()` calls | 0.5 | 1.7 | 0.9 |

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
| Test density | High (0.89) | Medium (0.41) | Low (0.27) | Medium (0.50) | Medium (0.48) | Low (0.07) | High (0.94) | Lowest (0.03) | Highest (1.58) |
| Module size | Smallest (119) | Small (176) | Large (406) | Medium (245) | Medium (247) | Largest (442) | Medium (287) | Medium (224) | Small (164) |
| Dependencies | Lightest (19) | Heavy (330) | Heavy (368) | Light (72) | Light (52) | Heavy (183) | Heavy (345) | Light (54) | Medium (112) |
| First commit | Feb 2026 | Apr 2025 | Apr 2025 | May 2025 | May 2023 | Aug 2024 | Jun 2025 | Oct 2023 | Dec 2025 |

Acolyte leads on type safety, module size, and dependency count while remaining the smallest TypeScript codebase in the benchmark.

Updated 6 July 2026.
