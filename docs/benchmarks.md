# Benchmarks

These benchmarks compare Acolyte with eight open-source coding agents using static source counts and normalized pattern counts.

For feature and architecture comparisons, see [Comparison](./comparison.md).

All metrics extracted with [`scripts/benchmark.ts`](../scripts/benchmark.ts).

## Methodology

- **Source lines** = total lines of source code (including blanks and comments)
- Test files, known generated directories, and source files over **10k lines** are excluded
- Metrics normalized **per 1k source lines** where applicable
- Dependencies are direct declarations detected in each ecosystem's manifests and shown as **runtime + development**; Go modules do not distinguish development dependencies
- Each project is measured from a fresh shallow clone of its origin's default branch
- Snapshot revisions tie each result to the exact source measured, even after those branches move

## Closed systems

This methodology requires a comparable public source repository. Claude Code, Cursor, and Copilot are excluded from the source analysis.

## Projects compared

| Project | Revision | Language | Description | Source lines | Files | Dependencies |
|---|---|---|---|---|---|---|
| **Acolyte** | `178136ee6418` | TypeScript | Terminal coding agent with lifecycle, effects, and AST code tools | 30,294 | 249 | 10 + 6 |
| OpenCode | `cb8be9ba1217` | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 409,049 | 2,287 | 222 + 110 |
| Codex | `325cf161940c` | Rust | Terminal AI coding agent from OpenAI | 867,770 | 2,144 | 289 + 81 |
| Crush | `4721e53c30a0` | Go | Terminal AI coding agent from Charm with Bubble Tea TUI | 83,525 | 334 | 72 + 0 |
| Aider | `5dc9490bb35f` | Python | AI pair programming in your terminal | 25,958 | 105 | 35 + 17 |
| Goose | `2ecb8c089487` | Rust | Extensible AI agent from Block with MCP integration | 196,264 | 425 | 157 + 22 |
| Qwen Code | `515a83110af5` | TypeScript | Terminal AI coding agent from Alibaba | 953,849 | 3,193 | 219 + 134 |
| Plandex | `e2d772072efa` | Go | AI coding agent for large multi-file tasks in the terminal | 74,573 | 333 | 54 + 0 |
| Mistral Vibe | `30792a4cac2c` | Python | Terminal AI coding agent from Mistral | 64,104 | 378 | 96 + 16 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| External imports / 1k LOC | 6.9 | 18.9 | 7.0 |
| Runtime dependencies | 10 | 222 | 219 |

_TypeScript projects only._

Acolyte has the lowest external import density and fewest runtime dependencies among TypeScript projects.

## Input validation density

Counts `.parse()`, `.safeParse()`, and `.validate()` call sites per 1k source lines. This measures validation patterns, not runtime path coverage.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| Parse and validation calls / 1k LOC | 2.7 | 0.5 | 0.5 |
| `.safeParse()` calls / 1k | 1.0 | 0.0 | 0.0 |

_TypeScript projects only._

Acolyte has the highest combined parse and validation call density, as well as the highest `.safeParse()` call density, among the TypeScript projects.

## TypeScript type safety signals

Per 1k source lines.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| `as any` | 0.0 | 1.0 | 0.2 |
| `: any` annotations | 0.0 | 0.6 | 0.3 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 |
| Lint ignores | 0.2 | 0.0 | 0.2 |
| `: unknown` usage | 3.1 | 2.5 | 2.9 |

Acolyte has one measured `as any` occurrence and no `: any` annotations or TypeScript suppression comments.

## Language-specific type safety signals

Per 1k source lines.

| Metric | Aider | Mistral Vibe | Goose | Codex | Crush | Plandex |
|---|---|---|---|---|---|---|
| `type: ignore` (Python) | 0.0 | 0.1 | — | — | — | — |
| `Any` usage (Python) | 0.1 | 11.2 | — | — | — | — |
| `cast()` calls (Python) | 0.0 | 0.6 | — | — | — | — |
| `unsafe` (Rust) | — | — | 0.1 | 0.8 | — | — |
| `.unwrap()` (Rust) | — | — | 14.2 | 2.8 | — | — |
| `.expect()` (Rust) | — | — | 2.0 | 13.5 | — | — |
| `any` / `interface{}` (Go) | — | — | — | — | 4.6 | 4.4 |
| `panic()` (Go) | — | — | — | — | 0.2 | 0.3 |
| `nolint` (Go) | — | — | — | — | 0.2 | 0.0 |

Aider has the lowest measured Python type-escape density. Mistral Vibe has the highest `Any` density. Codex has lower `.unwrap()` density than Goose but substantially higher `.expect()` density.

## Test density

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Test files | 204 | 689 | 391 | 167 | 42 | 25 | 1,752 | 6 | 424 |
| Test lines | 28,367 | 166,129 | 241,050 | 39,521 | 12,470 | 13,974 | 943,051 | 2,517 | 98,214 |
| Ratio | 0.94 | 0.41 | 0.28 | 0.47 | 0.48 | 0.07 | 0.99 | 0.03 | 1.53 |

Acolyte has 0.94 test lines per source line. This ratio measures test volume, not executed coverage or test effectiveness.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.tsx`)
- performance (`*.perf.test.ts`)

## Module size

| Metric | Acolyte | OpenCode | Codex | Crush | Aider | Goose | Qwen Code | Plandex | Mistral Vibe |
|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 122 | 179 | 405 | 250 | 247 | 462 | 299 | 224 | 170 |
| Files > 500 lines | 3 (1%) | 190 (8%) | 491 (23%) | 35 (10%) | 14 (13%) | 124 (29%) | 446 (14%) | 36 (11%) | 20 (5%) |
| Largest file | 656 | 7,220 | 6,352 | 4,578 | 2,486 | 4,246 | 8,944 | 2,455 | 4,244 |
| Barrel / index files | 1 | 70 | 74 | 2 | 5 | 50 | 161 | 0 | 56 |

Acolyte maintains the smallest average module size and fewest large files.

## Error-handling patterns

Per 1k source lines.

| Metric | Acolyte | OpenCode | Qwen Code |
|---|---|---|---|
| `.safeParse()` calls | 1.0 | 0.0 | 0.0 |
| `try { ... }` blocks | 5.8 | 1.2 | 5.5 |
| `.catch()` calls | 0.5 | 1.7 | 0.9 |

_TypeScript projects only._

Acolyte has the highest `.safeParse()` call density among the TypeScript projects. The count is a proxy for validation structure, not proof that every runtime path is validated.

## Key takeaways

At this snapshot, Acolyte has:

- The lowest measured `any` escape density among the TypeScript projects
- The smallest average module size and lowest large-file density
- The lowest counted dependency total
- The highest combined parse and validation call density among the TypeScript projects
- A 0.94 test-to-source line ratio

These are static source metrics. They describe code structure and validation patterns, not runtime correctness, model quality, or task performance.

## Summary

Acolyte remains the smallest TypeScript codebase in the benchmark. It has the lowest counted dependency total and smallest average module size across all projects. Qwen Code has a slightly higher test-to-source ratio, while Mistral Vibe has the highest ratio overall.

Updated 14 July 2026.
