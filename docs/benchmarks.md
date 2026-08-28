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
- installed dependencies are excluded, so an imported agent harness is not counted while a vendored or self-written one is; Kimchi imports the pi harness
- snapshot revisions tie each result to the exact source measured
- projects are ordered by language (TypeScript, Rust, Go), with Acolyte first and others alphabetical within each language

These are structural signals, not measures of model quality, runtime correctness, or task success. Repository-wide counts are especially difficult to compare when a project includes multiple clients, products, or bundled applications.

## Closed systems

This methodology requires a comparable public source repository. Claude Code, Cursor, and GitHub Copilot are excluded from the source analysis.

## Projects compared

| Project | Revision | Language | Source lines | Code | Comments | Blank | Files | Dependencies |
|---|---|---|---:|---:|---:|---:|---:|---:|
| **Acolyte** | `e13d6e0de793` | TypeScript | 35,238 | 30,512 | 1,400 | 3,326 | 279 | 12 + 6 |
| Kimchi | `4d40b544fc6a` | TypeScript | 134,476 | 99,806 | 20,428 | 14,242 | 665 | 25 + 19 |
| Kode | `c7f6fccf7ec4` | TypeScript | 140,184 | 121,205 | 3,208 | 15,771 | 1,059 | 57 + 46 |
| OpenCode | `755ebdb94ee7` | TypeScript | 487,347 | 439,907 | 9,720 | 37,720 | 2,497 | 219 + 107 |
| Qwen Code | `4b5396c69a35` | TypeScript | 1,025,545 | 787,967 | 168,033 | 69,545 | 2,747 | 150 + 129 |
| Codex | `94311d447587` | Rust | 1,141,643 | 979,319 | 71,866 | 90,458 | 2,912 | 343 + 93 |
| Goose | `f87c4d73d186` | Rust | 253,997 | 209,517 | 17,136 | 27,344 | 492 | 170 + 24 |
| Grok Build | `9684fa3cdbf2` | Rust | 1,559,580 | 1,208,983 | 239,632 | 110,965 | 2,479 | 338 + 80 |
| Reasonix | `e6218fc1ddf2` | Go | 413,808 | 339,978 | 40,125 | 33,705 | 1,866 | 55 + 0 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| External imports / 1k LOC | 7.1 | 7.1 | 27.7 | 16.5 | 4.6 |
| Runtime dependencies | 12 | 25 | 57 | 219 | 150 |

_TypeScript projects only._

Acolyte has the fewest runtime dependencies and lowest external-import density among the TypeScript projects except Qwen Code's slightly lower import count.

## Input validation density

Counts `.parse()`, `.safeParse()`, and `.validate()` call sites per 1k source lines. This measures validation patterns, not runtime path coverage.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| Parse and validation calls / 1k LOC | 3.1 | 1.1 | 0.7 | 0.4 | 0.6 |
| `.safeParse()` calls / 1k | 1.3 | 0.0 | 0.2 | 0.0 | 0.0 |

_TypeScript projects only._

Acolyte has the highest measured validation-call density in this TypeScript comparison.

## TypeScript type safety signals

Per 1k source lines.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| `as any` | 0.0 | 0.4 | 0.5 | 0.8 | 0.1 |
| `: any` annotations | 0.0 | 0.2 | 1.8 | 0.5 | 0.3 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.0 | 0.0 | 0.2 | 0.0 |
| Lint ignores | 0.1 | 0.8 | 0.1 | 0.0 | 0.2 |
| `: unknown` usage | 2.9 | 4.7 | 4.8 | 2.2 | 3.8 |

Acolyte has the lowest measured TypeScript escape-hatch density in this comparison. These counts do not establish correctness.

## Language-specific type safety signals

Per 1k source lines.

| Metric | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|
| `unsafe` (Rust) | 0.8 | 0.2 | 0.8 | — |
| `.unwrap()` (Rust) | 2.8 | 18.4 | 16.8 | — |
| `.expect()` (Rust) | 15.4 | 2.4 | 4.4 | — |
| `any` / `interface{}` (Go) | — | — | — | 3.0 |
| `panic()` (Go) | — | — | — | 0.1 |
| `nolint` (Go) | — | — | — | 0.0 |

## Test density

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Test files | 269 | 533 | 221 | 734 | 2,099 | 516 | 51 | 450 | 1,456 |
| Test lines | 41,211 | 164,289 | 27,671 | 176,483 | 1,585,127 | 354,981 | 25,482 | 170,125 | 374,308 |
| Ratio | 1.17 | 1.22 | 0.20 | 0.36 | 1.55 | 0.31 | 0.10 | 0.11 | 0.90 |

This ratio measures test volume, not executed coverage or test effectiveness.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.tsx`)
- performance (`*.perf.test.ts`)

## Module size

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Avg lines / file | 126 | 202 | 132 | 195 | 373 | 392 | 516 | 629 | 222 |
| Files > 500 lines | 6 (2%) | 60 (9%) | 22 (2%) | 243 (10%) | 509 (19%) | 621 (21%) | 153 (31%) | 890 (36%) | 200 (11%) |
| Largest file | 1,019 | 4,759 | 1,792 | 7,220 | 9,661 | 8,624 | 6,208 | 8,212 | 8,435 |
| Barrel / index files | 1 | 38 | 34 | 70 | 87 | 86 | 51 | 208 | 8 |

Acolyte has the smallest average module size and one of the lowest large-file densities in this snapshot.

## Error-handling patterns

Per 1k source lines.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| `.safeParse()` calls | 1.3 | 0.0 | 0.2 | 0.0 | 0.0 |
| `try { ... }` blocks | 6.0 | 7.0 | 6.1 | 1.0 | 6.2 |
| `.catch()` calls | 0.6 | 1.1 | 0.3 | 1.4 | 1.0 |

_TypeScript projects only._

Acolyte has the highest `.safeParse()` call density among the TypeScript projects. The count is a proxy for validation structure, not proof that every runtime path is validated.

## Key takeaways

At this snapshot, Acolyte has:

- the lowest measured TypeScript escape-hatch density
- the smallest average module size and one of the lowest large-file densities
- the fewest runtime dependencies
- the highest measured TypeScript validation-call density
- a 1.17 test-to-source line ratio

These signals describe source structure and engineering patterns. They do not rank model quality or user-visible reliability.

Updated 28 August 2026.
