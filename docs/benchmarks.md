# Benchmarks

Static code quality benchmarks compare Acolyte with eight current open-source terminal coding agents using source, dependency, test, and type-safety metrics.

For feature and architecture comparisons, see [Comparison](./comparison.md). Both documents use the same competitor set.

All metrics are extracted with [`scripts/benchmark.ts`](../scripts/benchmark.ts).

## Methodology

- **Source lines** = total lines in included source files, including code, comments, and blanks
- Code, comment, and blank line counts are reported separately; comment classification is based on leading comment markers
- Test files, known generated directories, and source files over **10k lines** are excluded
- Metrics normalized **per 1k source lines** where applicable
- Dependencies are direct declarations detected in the included project manifests and shown as **runtime + development**; Go modules do not distinguish development dependencies
- Each project is measured from a fresh shallow clone of its origin's default branch
- Snapshot revisions tie each result to the exact source measured
- Projects are ordered by language (TypeScript, Rust, Go), with Acolyte first and others alphabetical within each language

These are structural signals, not measures of model quality, runtime correctness, or task success. Repository-wide counts are especially difficult to compare when a project includes multiple clients, products, or bundled applications.

## Closed systems

This methodology requires a comparable public source repository. Claude Code, Cursor, and GitHub Copilot are excluded from the source analysis.

## Projects compared

| Project | Revision | Language | Source lines | Code | Comments | Blank | Files | Dependencies |
|---|---|---|---:|---:|---:|---:|---:|---:|
| **Acolyte** | `45faab86bbf1` | TypeScript | 33,919 | 29,782 | 1,026 | 3,111 | 271 | 12 + 6 |
| Kimchi | `5f5ff385b59f` | TypeScript | 115,831 | 87,640 | 15,487 | 12,704 | 600 | 25 + 19 |
| Kode | `4afba64cec25` | TypeScript | 212,769 | 182,282 | 6,879 | 23,608 | 1,427 | 70 + 55 |
| OpenCode | `7534d23551f6` | TypeScript | 417,984 | 371,438 | 9,697 | 36,849 | 2,330 | 222 + 111 |
| Qwen Code | `d44030a4c074` | TypeScript | 1,031,339 | 786,750 | 160,674 | 83,915 | 3,362 | 218 + 137 |
| Codex | `61a44880a85d` | Rust | 931,133 | 792,995 | 61,484 | 76,654 | 2,332 | 328 + 87 |
| Goose | `87e6a8c9ac65` | Rust | 204,169 | 167,457 | 14,000 | 22,712 | 436 | 162 + 20 |
| Grok Build | `b41c75a578f9` | Rust | 1,300,300 | 995,510 | 209,293 | 95,497 | 2,023 | 309 + 71 |
| Reasonix | `c846ad5559ca` | Go | 227,879 | 187,928 | 22,257 | 17,694 | 740 | 45 + 0 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| External imports / 1k LOC | 7.2 | 7.3 | 21.3 | 19.0 | 6.8 |
| Runtime dependencies | 12 | 25 | 70 | 222 | 218 |

_TypeScript projects only._

Acolyte has the fewest runtime dependencies and lowest external-import density among the TypeScript projects except Qwen Code's slightly lower import count.

## Input validation density

Counts `.parse()`, `.safeParse()`, and `.validate()` call sites per 1k source lines. This measures validation patterns, not runtime path coverage.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| Parse and validation calls / 1k LOC | 3.0 | 1.2 | 0.9 | 0.5 | 0.5 |
| `.safeParse()` calls / 1k | 1.2 | 0.0 | 0.2 | 0.0 | 0.0 |

_TypeScript projects only._

Acolyte has the highest measured validation-call density in this TypeScript comparison.

## TypeScript type safety signals

Per 1k source lines.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| `as any` | 0.0 | 0.4 | 0.9 | 0.9 | 0.2 |
| `: any` annotations | 0.0 | 0.2 | 2.6 | 0.6 | 0.2 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.0 | 0.0 | 0.2 | 0.0 |
| Lint ignores | 0.2 | 0.8 | 0.1 | 0.0 | 0.2 |
| `: unknown` usage | 2.8 | 4.8 | 4.5 | 2.5 | 3.1 |

Acolyte has the lowest measured TypeScript escape-hatch density in this comparison. These counts do not establish correctness.

## Language-specific type safety signals

Per 1k source lines.

| Metric | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|
| `unsafe` (Rust) | 0.9 | 0.2 | 0.7 | — |
| `.unwrap()` (Rust) | 2.7 | 14.7 | 16.5 | — |
| `.expect()` (Rust) | 14.3 | 2.1 | 3.6 | — |
| `any` / `interface{}` (Go) | — | — | — | 4.0 |
| `panic()` (Go) | — | — | — | 0.1 |
| `nolint` (Go) | — | — | — | 0.0 |

## Test density

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Test files | 252 | 447 | 493 | 707 | 1,948 | 419 | 27 | 358 | 664 |
| Test lines | 35,016 | 128,913 | 75,247 | 170,415 | 1,092,273 | 259,132 | 14,742 | 135,116 | 204,978 |
| Ratio | 1.03 | 1.11 | 0.35 | 0.41 | 1.06 | 0.28 | 0.07 | 0.10 | 0.90 |

This ratio measures test volume, not executed coverage or test effectiveness.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.tsx`)
- performance (`*.perf.test.ts`)

## Module size

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Avg lines / file | 125 | 193 | 149 | 179 | 307 | 399 | 468 | 643 | 308 |
| Files > 500 lines | 5 (2%) | 46 (8%) | 53 (4%) | 198 (8%) | 488 (15%) | 522 (22%) | 131 (30%) | 733 (36%) | 113 (15%) |
| Largest file | 964 | 4,664 | 2,453 | 7,220 | 8,606 | 7,407 | 4,425 | 9,768 | 8,907 |
| Barrel / index files | 1 | 36 | 73 | 70 | 162 | 77 | 51 | 199 | 2 |

Acolyte has the smallest average module size and fewest large files in this snapshot.

## Error-handling patterns

Per 1k source lines.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| `.safeParse()` calls | 1.2 | 0.0 | 0.2 | 0.0 | 0.0 |
| `try { ... }` blocks | 5.9 | 6.8 | 6.2 | 1.1 | 5.6 |
| `.catch()` calls | 0.4 | 0.9 | 0.5 | 1.6 | 1.0 |

_TypeScript projects only._

Acolyte has the highest `.safeParse()` call density among the TypeScript projects. The count is a proxy for validation structure, not proof that every runtime path is validated.

## Key takeaways

At this snapshot, Acolyte has:

- The lowest measured TypeScript escape-hatch density
- The smallest average module size and lowest large-file density
- The fewest runtime dependencies
- The highest measured TypeScript validation-call density
- A 1.03 test-to-source line ratio

These signals describe source structure and engineering patterns. They do not rank model quality or user-visible reliability.

Updated 27 July 2026.
