# Benchmarks

These benchmarks compare Acolyte with eight current open-source terminal coding agents using static source counts and normalized pattern counts.

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

These are structural signals, not measures of model quality, runtime correctness, or task success. Repository-wide counts are especially difficult to compare when a project includes multiple clients, products, or bundled applications.

## Closed systems

This methodology requires a comparable public source repository. Claude Code, Cursor, and GitHub Copilot are excluded from the source analysis.

## Projects compared

| Project | Revision | Language | Source lines | Code | Comments | Blank | Files | Dependencies |
|---|---|---|---:|---:|---:|---:|---:|---:|
| **Acolyte** | `8590335ddca0` | TypeScript | 31,068 | 27,336 | 795 | 2,937 | 257 | 10 + 6 |
| OpenCode | `d36a2d8981ba` | TypeScript | 414,504 | 368,156 | 9,594 | 36,754 | 2,315 | 222 + 111 |
| Codex | `5c18cc0acc37` | Rust | 895,943 | 761,928 | 59,748 | 74,267 | 2,256 | 326 + 84 |
| Goose | `36cb569e366f` | Rust | 200,974 | 164,705 | 13,913 | 22,356 | 428 | 162 + 20 |
| Open Interpreter | `a4da0fc3cece` | Rust | 897,914 | 764,463 | 59,105 | 74,346 | 2,171 | 333 + 84 |
| Reasonix | `9eb9511f8b20` | Go | 205,633 | 168,750 | 20,886 | 15,997 | 641 | 45 + 0 |
| Kimchi | `53a1d48a9521` | TypeScript | 115,150 | 87,314 | 15,187 | 12,649 | 595 | 25 + 19 |
| Qwen Code | `9e822d6004d8` | TypeScript | 996,211 | 756,505 | 157,627 | 82,079 | 3,265 | 218 + 137 |
| Grok Build | `ba76b0a683fa` | Rust | 1,229,473 | 932,162 | 206,652 | 90,659 | 1,926 | 306 + 71 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | OpenCode | Kimchi | Qwen Code |
|---|---:|---:|---:|---:|
| External imports / 1k LOC | 7.0 | 18.9 | 7.4 | 6.9 |
| Runtime dependencies | 10 | 222 | 25 | 218 |

_TypeScript projects only._

Acolyte has the fewest runtime dependencies and lowest external-import density among the TypeScript projects except Qwen Code's slightly lower import count.

## Input validation density

Counts `.parse()`, `.safeParse()`, and `.validate()` call sites per 1k source lines. This measures validation patterns, not runtime path coverage.

| Metric | Acolyte | OpenCode | Kimchi | Qwen Code |
|---|---:|---:|---:|---:|
| Parse and validation calls / 1k LOC | 3.1 | 0.5 | 1.2 | 0.5 |
| `.safeParse()` calls / 1k | 1.3 | 0.0 | 0.0 | 0.0 |

_TypeScript projects only._

Acolyte has the highest measured validation-call density in this TypeScript comparison.

## TypeScript type safety signals

Per 1k source lines.

| Metric | Acolyte | OpenCode | Kimchi | Qwen Code |
|---|---:|---:|---:|---:|
| `as any` | 0.0 | 0.9 | 0.4 | 0.2 |
| `: any` annotations | 0.0 | 0.6 | 0.2 | 0.2 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 | 0.0 |
| Lint ignores | 0.2 | 0.0 | 0.8 | 0.2 |
| `: unknown` usage | 3.2 | 2.5 | 4.8 | 3.0 |

Acolyte has the lowest measured TypeScript escape-hatch density in this comparison. These counts do not establish correctness.

## Language-specific type safety signals

Per 1k source lines.

| Metric | Goose | Open Interpreter | Codex | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|
| `unsafe` (Rust) | 0.2 | 0.8 | 0.8 | 0.8 | — |
| `.unwrap()` (Rust) | 14.5 | 2.8 | 2.8 | 15.8 | — |
| `.expect()` (Rust) | 2.1 | 13.1 | 13.7 | 3.7 | — |
| `any` / `interface{}` (Go) | — | — | — | — | 3.5 |
| `panic()` (Go) | — | — | — | — | 0.2 |
| `nolint` (Go) | — | — | — | — | 0.0 |

## Test density

| Metric | Acolyte | OpenCode | Codex | Goose | Open Interpreter | Reasonix | Kimchi | Qwen Code | Grok Build |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Test files | 216 | 700 | 405 | 26 | 397 | 596 | 440 | 1,838 | 343 |
| Test lines | 29,636 | 167,792 | 253,205 | 14,638 | 237,596 | 180,152 | 127,960 | 1,018,902 | 132,351 |
| Ratio | 0.95 | 0.40 | 0.28 | 0.07 | 0.26 | 0.88 | 1.11 | 1.02 | 0.11 |

This ratio measures test volume, not executed coverage or test effectiveness.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.tsx`)
- performance (`*.perf.test.ts`)

## Module size

| Metric | Acolyte | OpenCode | Codex | Goose | Open Interpreter | Reasonix | Kimchi | Qwen Code | Grok Build |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Avg lines / file | 121 | 179 | 397 | 470 | 414 | 321 | 194 | 305 | 638 |
| Files > 500 lines | 3 (1%) | 194 (8%) | 503 (22%) | 128 (30%) | 504 (23%) | 101 (16%) | 46 (8%) | 469 (14%) | 692 (36%) |
| Largest file | 619 | 7,220 | 7,349 | 4,428 | 6,352 | 10,000 | 4,664 | 9,799 | 9,768 |
| Barrel / index files | 1 | 70 | 77 | 50 | 73 | 2 | 36 | 161 | 190 |

Acolyte has the smallest average module size and fewest large files in this snapshot.

## Error-handling patterns

Per 1k source lines.

| Metric | Acolyte | OpenCode | Kimchi | Qwen Code |
|---|---:|---:|---:|---:|
| `.safeParse()` calls | 1.3 | 0.0 | 0.0 | 0.0 |
| `try { ... }` blocks | 6.1 | 1.2 | 6.8 | 5.6 |
| `.catch()` calls | 0.4 | 1.6 | 0.9 | 0.9 |

_TypeScript projects only._

Acolyte has the highest `.safeParse()` call density among the TypeScript projects. The count is a proxy for validation structure, not proof that every runtime path is validated.

## Key takeaways

At this snapshot, Acolyte has:

- The lowest measured TypeScript escape-hatch density
- The smallest average module size and lowest large-file density
- The fewest runtime dependencies
- The highest measured TypeScript validation-call density
- A 0.95 test-to-source line ratio

These signals describe source structure and engineering patterns. They do not rank model quality or user-visible reliability.

Updated 20 July 2026.
