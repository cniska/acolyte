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
| **Acolyte** | `83fddd5c2322` | TypeScript | 31,068 | 27,336 | 795 | 2,937 | 257 | 10 + 6 |
| Kimchi | `53a1d48a9521` | TypeScript | 115,150 | 87,314 | 15,187 | 12,649 | 595 | 25 + 19 |
| Kode | `f27c996168d2` | TypeScript | 212,170 | 181,828 | 6,825 | 23,517 | 1,424 | 70 + 53 |
| OpenCode | `4cc022481c18` | TypeScript | 414,510 | 368,160 | 9,594 | 36,756 | 2,315 | 222 + 111 |
| Qwen Code | `067860ad733b` | TypeScript | 996,538 | 756,773 | 157,677 | 82,088 | 3,265 | 218 + 137 |
| Codex | `5a4f5ee64c4e` | Rust | 896,607 | 762,497 | 59,798 | 74,312 | 2,256 | 327 + 84 |
| Goose | `36cb569e366f` | Rust | 200,974 | 164,705 | 13,913 | 22,356 | 428 | 162 + 20 |
| Grok Build | `a881e6703f46` | Rust | 1,232,633 | 935,000 | 206,941 | 90,692 | 1,929 | 306 + 71 |
| Reasonix | `9eb9511f8b20` | Go | 205,633 | 168,750 | 20,886 | 15,997 | 641 | 45 + 0 |

## Dependency surface area

Measures how much of a codebase depends on external packages.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| External imports / 1k LOC | 7.0 | 7.4 | 21.3 | 18.9 | 6.9 |
| Runtime dependencies | 10 | 25 | 70 | 222 | 218 |

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
| Lint ignores | 0.2 | 0.8 | 0.1 | 0.0 | 0.2 |
| `: unknown` usage | 3.2 | 4.8 | 4.5 | 2.5 | 3.0 |

Acolyte has the lowest measured TypeScript escape-hatch density in this comparison. These counts do not establish correctness.

## Language-specific type safety signals

Per 1k source lines.

| Metric | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|
| `unsafe` (Rust) | 0.8 | 0.2 | 0.8 | — |
| `.unwrap()` (Rust) | 2.8 | 14.5 | 15.9 | — |
| `.expect()` (Rust) | 13.7 | 2.1 | 3.7 | — |
| `any` / `interface{}` (Go) | — | — | — | 3.5 |
| `panic()` (Go) | — | — | — | 0.2 |
| `nolint` (Go) | — | — | — | 0.0 |

## Test density

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Test files | 216 | 440 | 492 | 700 | 1,838 | 406 | 26 | 345 | 596 |
| Test lines | 29,636 | 127,960 | 75,079 | 167,828 | 1,019,323 | 253,476 | 14,638 | 132,849 | 180,152 |
| Ratio | 0.95 | 1.11 | 0.35 | 0.40 | 1.02 | 0.28 | 0.07 | 0.11 | 0.88 |

This ratio measures test volume, not executed coverage or test effectiveness.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.tsx`)
- performance (`*.perf.test.ts`)

## Module size

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code | Codex | Goose | Grok Build | Reasonix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Avg lines / file | 121 | 194 | 149 | 179 | 305 | 397 | 470 | 639 | 321 |
| Files > 500 lines | 3 (1%) | 46 (8%) | 53 (4%) | 194 (8%) | 469 (14%) | 502 (22%) | 128 (30%) | 694 (36%) | 101 (16%) |
| Largest file | 619 | 4,664 | 2,453 | 7,220 | 9,818 | 7,349 | 4,428 | 9,768 | 10,000 |
| Barrel / index files | 1 | 36 | 73 | 70 | 161 | 77 | 50 | 190 | 2 |

Acolyte has the smallest average module size and fewest large files in this snapshot.

## Error-handling patterns

Per 1k source lines.

| Metric | Acolyte | Kimchi | Kode | OpenCode | Qwen Code |
|---|---:|---:|---:|---:|---:|
| `.safeParse()` calls | 1.3 | 0.0 | 0.2 | 0.0 | 0.0 |
| `try { ... }` blocks | 6.1 | 6.8 | 6.2 | 1.2 | 5.6 |
| `.catch()` calls | 0.4 | 0.9 | 0.5 | 1.6 | 0.9 |

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
