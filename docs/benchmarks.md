# Benchmarks

Static code quality benchmarks compare Acolyte with eight current open-source terminal coding agents using source, dependency, test, and type-safety metrics.

For feature and architecture comparisons, see [Comparison](./comparison.md). Both documents use the same competitor set.

All metrics are extracted with [`scripts/benchmark.ts`](../scripts/benchmark.ts).

## Methodology

- **Source lines** = total lines in included source files, including code, comments, and blanks
- code, comment, and blank line counts are reported separately; comment classification is based on leading comment markers
- test files, known generated directories, and source files over **10k lines** are excluded
- metrics normalized **per 1k source lines** where applicable
- dependencies are direct declarations detected in the included project manifests and shown as **runtime + development**; Go modules do not distinguish development dependencies
- each project is measured from a fresh shallow clone of its origin's default branch
- snapshot revisions tie each result to the exact source measured
- projects are ordered by language (TypeScript, Rust, Go), with Acolyte first and others alphabetical within each language

These are structural signals, not measures of model quality, runtime correctness, or task success. Repository-wide counts are especially difficult to compare when a project includes multiple clients, products, or bundled applications.

## Closed systems

This methodology requires a comparable public source repository. Claude Code, Cursor, and GitHub Copilot are excluded from the source analysis.

## Projects compared

| Project | Revision | Language | Source lines | Code | Comments | Blank | Files | Dependencies |
|---|---|---|---:|---:|---:|---:|---:|---:|
| **Acolyte** | `0d0dfe7db66d` | TypeScript | 33,967 | 29,660 | 1,155 | 3,152 | 273 | 12 + 6 |
| Kimchi | `e6fd6e14ff0f` | TypeScript | 117,897 | 88,952 | 16,039 | 12,906 | 612 | 25 + 19 |
| Kode | `4afba64cec25` | TypeScript | 212,769 | 182,282 | 6,879 | 23,608 | 1,427 | 70 + 55 |
| OpenCode | `1882c33827cf` | TypeScript | 419,408 | 372,795 | 9,696 | 36,917 | 2,341 | 223 + 111 |
| Qwen Code | `e1e5b42ce110` | TypeScript | 1,079,646 | 826,110 | 167,121 | 86,415 | 3,458 | 224 + 139 |
| Codex | `9949245d1d2b` | Rust | 960,785 | 819,028 | 62,918 | 78,839 | 2,416 | 330 + 89 |
| Goose | `c413303ae015` | Rust | 211,710 | 173,947 | 14,400 | 23,363 | 440 | 162 + 20 |
| Grok Build | `a4221165824e` | Rust | 1,336,256 | 1,023,733 | 214,966 | 97,557 | 2,078 | 316 + 74 |
| Reasonix | `15d335b86b31` | Go | 252,140 | 209,150 | 23,827 | 19,163 | 784 | 48 + 0 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| External imports / 1k LOC | 7.2 | 7.4 | 21.3 | 19.0 | 6.7 |
| Runtime dependencies | 12 | 25 | 70 | 223 | 224 |

_TypeScript projects only._

Acolyte has the fewest runtime dependencies and lowest external-import density among the TypeScript projects except Qwen Code's slightly lower import count.

## Input validation density

Counts `.parse()`, `.safeParse()`, and `.validate()` call sites per 1k source lines. This measures validation patterns, not runtime path coverage.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| Parse and validation calls / 1k LOC | 3.1 | 1.2 | 0.9 | 0.5 | 0.5 |
| `.safeParse()` calls / 1k | 1.3 | 0.0 | 0.2 | 0.0 | 0.0 |

_TypeScript projects only._

Acolyte has the highest measured validation-call density in this TypeScript comparison.

## TypeScript type safety signals

Per 1k source lines.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| `as any` | 0.0 | 0.4 | 0.9 | 0.9 | 0.2 |
| `: any` annotations | 0.0 | 0.2 | 2.6 | 0.6 | 0.2 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.0 | 0.0 | 0.2 | 0.0 |
| Lint ignores | 0.1 | 0.7 | 0.1 | 0.0 | 0.2 |
| `: unknown` usage | 2.9 | 4.7 | 4.5 | 2.5 | 3.1 |

Acolyte has the lowest measured TypeScript escape-hatch density in this comparison. These counts do not establish correctness.

## Language-specific type safety signals

Per 1k source lines.

| Metric | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|
| `unsafe` (Rust) | 0.8 | 0.2 | 0.7 | — |
| `.unwrap()` (Rust) | 2.8 | 15.1 | 16.5 | — |
| `.expect()` (Rust) | 14.6 | 2.3 | 3.7 | — |
| `any` / `interface{}` (Go) | — | — | — | 3.8 |
| `panic()` (Go) | — | — | — | 0.1 |
| `nolint` (Go) | — | — | — | 0.0 |

## Test density

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Test files | 258 | 454 | 493 | 716 | 2,056 | 437 | 29 | 379 | 713 |
| Test lines | 37,608 | 131,930 | 75,247 | 171,542 | 1,202,588 | 276,452 | 15,211 | 142,153 | 235,158 |
| Ratio | 1.11 | 1.12 | 0.35 | 0.41 | 1.11 | 0.29 | 0.07 | 0.11 | 0.93 |

This ratio measures test volume, not executed coverage or test effectiveness.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.tsx`)
- performance (`*.perf.test.ts`)

## Module size

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Avg lines / file | 124 | 193 | 149 | 179 | 312 | 398 | 481 | 643 | 322 |
| Files > 500 lines | 5 (2%) | 46 (8%) | 53 (4%) | 200 (9%) | 521 (15%) | 534 (22%) | 133 (30%) | 748 (36%) | 130 (17%) |
| Largest file | 974 | 4,664 | 2,453 | 7,220 | 9,447 | 7,521 | 4,791 | 9,768 | 9,435 |
| Barrel / index files | 1 | 37 | 73 | 70 | 163 | 78 | 51 | 201 | 2 |

Acolyte has the smallest average module size and fewest large files in this snapshot.

## Error-handling patterns

Per 1k source lines.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| `.safeParse()` calls | 1.3 | 0.0 | 0.2 | 0.0 | 0.0 |
| `try { ... }` blocks | 6.0 | 6.8 | 6.2 | 1.1 | 5.7 |
| `.catch()` calls | 0.5 | 1.0 | 0.5 | 1.6 | 1.0 |

_TypeScript projects only._

Acolyte has the highest `.safeParse()` call density among the TypeScript projects. The count is a proxy for validation structure, not proof that every runtime path is validated.

## Key takeaways

At this snapshot, Acolyte has:

- the lowest measured TypeScript escape-hatch density
- the smallest average module size and lowest large-file density
- the fewest runtime dependencies
- the highest measured TypeScript validation-call density
- a 1.11 test-to-source line ratio

These signals describe source structure and engineering patterns. They do not rank model quality or user-visible reliability.

Updated 2 August 2026.
