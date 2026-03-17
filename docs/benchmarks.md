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
| **Acolyte** | TypeScript | CLI-first AI coding agent with lifecycle, guards, evaluators, and AST code tools | 22,463 | 174 | 12 + 6 |
| **Codex** | Rust | Terminal AI coding agent from OpenAI with multi-platform support | 517,261 | 1,109 | 226 + 55 |
| **Aider** | Python | AI pair programming in your terminal | 25,938 | 105 | 35 + 17 |
| **Plandex** | Go | AI coding agent for large multi-file tasks in the terminal | 74,573 | 333 | 54 + 0 |
| **OpenCode** | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 216,717 | 1,061 | 173 + 79 |
| **Pi** | TypeScript | Terminal coding agent harness with extensions | 100,511 | 395 | 50 + 19 |
| **Continue** | TypeScript | AI code assistant for VS Code and JetBrains | 231,361 | 1,461 | 186 + 164 |
| **Cline** | TypeScript | Autonomous AI coding agent for VS Code | 202,584 | 1,230 | 155 + 70 |
| **OpenHands** | Python | AI-driven software development platform | 122,398 | 704 | 83 + 7 |
| **Goose** | Rust | Extensible AI agent from Block with MCP integration | 122,329 | 327 | 139 + 15 |
| **OpenClaw** | TypeScript | Personal AI assistant with coding agent skill | 688,512 | 3,798 | 109 + 47 |

Each runtime dependency has a specific job — the AI SDK for model calls, Zod for validation, a custom React reconciler for the TUI, and tiktoken for token counting.

## Dependency surface area

Measures how much of a codebase depends on external packages.

External imports include package imports that resolve **outside the repository**.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| External imports / 1k LOC | 6.2 | 16.7 | 9.1 | 22.3 | 10.0 | 4.5 |
| Runtime dependencies | 12 | 173 | 50 | 155 | 186 | 109 |

_TypeScript projects only._

Lower values indicate a more self-contained codebase with fewer external dependencies.

Acolyte has the second-lowest external import density (6.2/1k), behind only OpenClaw (4.5/1k), and the fewest runtime dependencies by a wide margin.

## Input validation coverage

Measures how frequently data entering the system is validated.

Includes schema validation calls such as `safeParse`, `parse`, and `validate`.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| Schema validations / 1k LOC | 2.4 | 0.7 | 0.7 | 1.2 | 0.9 | 0.5 |
| `.safeParse()` calls | 1.1 | 0.1 | 0.0 | 0.0 | 0.1 | 0.0 |

_TypeScript projects only._

Higher values indicate stronger runtime validation of model outputs, RPC payloads, and configuration data.

Acolyte validates at 2.4/1k — roughly 2–5× the rate of every other project in the benchmark.

## Type safety — TypeScript

Per 1k source lines.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `as any` | 0.1 | 1.8 | 1.4 | 0.8 | 2.3 | 0.1 |
| `: any` annotations | 0.0 | 1.0 | 1.3 | 2.3 | 4.4 | 0.2 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 | 0.1 | 0.4 | 0.0 |
| Lint ignores | 0.1 | 0.0 | 0.0 | 0.1 | 0.2 | 0.1 |
| `: unknown` usage | 5.2 | 1.5 | 1.1 | 0.4 | 0.3 | 5.6 |

Acolyte has **2 total `any`**. It uses `unknown` with explicit narrowing at high rates — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system.

## Type safety — Python, Rust, Go

Per 1k source lines.

| Metric | Aider | OpenHands | Goose | Codex | Plandex |
|---|---|---|---|---|---|
| `type: ignore` (Python) | 0.0 | 1.7 | — | — | — |
| `Any` usage (Python) | 0.1 | 3.5 | — | — | — |
| `cast()` calls (Python) | 0.0 | 0.3 | — | — | — |
| `unsafe` (Rust) | — | — | 0.0 | 0.9 | — |
| `.unwrap()` (Rust) | — | — | 11.8 | 2.7 | — |
| `.expect()` (Rust) | — | — | 1.4 | 8.6 | — |
| `any` / `interface{}` (Go) | — | — | — | — | 4.4 |
| `panic()` (Go) | — | — | — | — | 0.3 |
| `nolint` (Go) | — | — | — | — | 0.0 |

Aider shows minimal type escape hatches. Codex has much lower `.unwrap()` density than Goose (2.7 vs 11.8) but high `.expect()` density (8.6/1k) — errors are surfaced but rely on panicking assertions.


## Test quality

Measures test lines relative to source lines across all projects.

| Metric | Acolyte | Codex | Aider | Plandex | OpenCode | Pi | Continue | Cline | OpenHands | Goose | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Test files | 135 | 250 | 42 | 6 | 212 | 114 | 331 | 190 | 354 | 19 | 2,470 |
| Test lines | 18,054 | 102,934 | 12,410 | 2,517 | 42,289 | 36,120 | 82,506 | 48,170 | 143,114 | 5,579 | 526,910 |
| Test / source ratio | **0.80** | 0.20 | 0.48 | 0.03 | 0.20 | 0.36 | 0.36 | 0.24 | **1.17** | 0.05 | 0.77 |

Acolyte maintains a high test ratio because lifecycle phases, guards, and tools are independent modules with clean interfaces.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.ts`)
- performance (`*.perf.test.ts`)

## Module cohesion

Measures average file size, size distribution, and barrel file density.

| Metric | Acolyte | Codex | Aider | Plandex | OpenCode | Pi | Continue | Cline | OpenHands | Goose | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 129 | 466 | 247 | 224 | 204 | 254 | 158 | 165 | 174 | 374 | 181 |
| Files > 500 lines | 4 (2%) | 255 (23%) | 14 (13%) | 36 (11%) | 105 (10%) | 51 (13%) | 87 (6%) | 69 (6%) | 55 (8%) | 79 (24%) | 326 (9%) |
| Largest file | 721 | 9,835 | 2,486 | 2,455 | 4,964 | 4,443 | 3,229 | 4,758 | 1,715 | 2,506 | 2,875 |
| Barrel / index files | 1 | 59 | 5 | 0 | 50 | 26 | 73 | 47 | 85 | 44 | 79 |

Acolyte maintains the smallest average module size and fewest large files.

The flat `src/` layout keeps modules shallow with minimal re-exports and no circular dependencies.

## Error handling

Per 1k source lines.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `.safeParse()` calls | 1.1 | 0.1 | 0.0 | 0.0 | 0.1 | 0.0 |
| `try { ... }` blocks | 5.2 | 1.3 | 4.2 | 6.1 | 3.8 | 4.8 |
| `.catch()` calls | 0.6 | 2.2 | 0.3 | 1.1 | 0.3 | 1.0 |

_TypeScript projects only._

Acolyte validates boundaries with Zod `.safeParse()` at over **10× the rate** of most other projects.

RPC payloads, model responses, and configuration files are validated before entering the system.

## Key takeaways

Across the benchmarked projects, Acolyte demonstrates:

- Extremely low `any` usage and strong TypeScript safety
- The smallest modules and lowest large-file density
- The lightest dependency footprint
- High automated test coverage
- Clear lifecycle boundaries across independently testable modules

These characteristics reflect a deliberately small, strongly typed architecture — built so that lifecycle phases, guards, and tools behave predictably and can be independently verified.

## Summary

Consolidated comparison across all measured dimensions.

| Dimension | Acolyte | Codex | Aider | Plandex | OpenCode | Pi | Continue | Cline | OpenHands | Goose | OpenClaw |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Type safety | High | Medium | High | Medium | Medium | Medium | Lower | Medium | Ignore-heavy | Panic-heavy | High |
| Test density | High (0.80) | Low (0.20) | Medium (0.48) | Low (0.03) | Low (0.20) | Medium (0.36) | Medium (0.36) | Low (0.24) | Highest (1.17) | Lowest (0.05) | High (0.77) |
| Module size | Smallest (129) | Large (466) | Medium (247) | Medium (224) | Medium (204) | Medium (254) | Medium (158) | Medium (165) | Medium (174) | Largest (374) | Medium (181) |
| Dependencies | Lightest (18) | Heavy (281) | Light (52) | Light (54) | Heavy (252) | Light (69) | Heavy (350) | Heavy (225) | Medium (90) | Heavy (154) | Heavy (156) |
| Maturity | New | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped |

Acolyte leads on type safety, module size, and dependency count while remaining the smallest codebase in the benchmark.

Updated 17 March 2026.
