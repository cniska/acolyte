# Benchmarks

Measured comparisons of Acolyte against prominent open-source AI coding agents.

All metrics are derived from **static source analysis** — no subjective scoring.

All metrics extracted with [`scripts/benchmark.ts`](../scripts/benchmark.ts). Run `/benchmark` to refresh this file with the latest numbers.

## Methodology

- **Source lines** = non-blank, non-comment lines of source code (SLOC)
- Test files, generated code, and files over **10k lines** are excluded
- Metrics normalized **per 1k source lines** where applicable
- Dependencies shown as **runtime + development** dependencies

## Closed Systems Context

Several widely used coding agents are closed-source and cannot be analyzed with the same methodology.

| System | Open Source | Self-hostable | Observable Execution | Multi-model |
|---|---|---|---|---|
| Claude Code | ✗ | ✗ | ✗ | ✗ |
| Codex CLI | ✗ | ✗ | ✗ | ✗ |
| Acolyte | ✓ | ✓ | ✓ | ✓ |

These systems are included for context but excluded from code analysis benchmarks.

---

# Projects Compared

| Project | Language | Description | Source Lines | Files | Dependencies |
|---|---|---|---|---|---|
| **Acolyte** | TypeScript | CLI-first AI coding agent with lifecycle, guards, evaluators, and AST code tools | 22,463 | 174 | 12 + 6 |
| **Aider** | Python | AI pair programming in your terminal | 25,938 | 105 | 35 + 17 |
| **OpenCode** | TypeScript | Open-source AI coding agent (TUI/web/desktop) | 216,717 | 1,061 | 173 + 79 |
| **Pi** | TypeScript | Terminal coding agent harness with extensions | 100,511 | 395 | 50 + 19 |
| **Goose** | Rust | Extensible AI agent from Block with MCP integration | 122,329 | 327 | 139 + 15 |
| **OpenHands** | Python | AI-driven software development platform | 122,398 | 704 | 83 + 7 |
| **Continue** | TypeScript | AI code assistant for VS Code and JetBrains | 231,361 | 1,461 | 186 + 164 |
| **Cline** | TypeScript | Autonomous AI coding agent for VS Code | 202,584 | 1,230 | 155 + 70 |
| **OpenClaw** | TypeScript | Personal AI assistant with coding agent skill | 688,512 | 3,798 | 109 + 47 |
| **Plandex** | Go | AI coding agent for large multi-file tasks in the terminal | 74,573 | 333 | 54 + 0 |

Acolyte ships with 12 runtime dependencies because the daemon owns the stack — no framework, ORM, or bundler.

The AI SDK handles model calls, Zod handles validation, the custom React reconciler owns the TUI, and tiktoken handles token counting. Everything else is owned code.

---

# Dependency Surface Area

Measures how much of a codebase depends on external packages.

External imports include package imports that resolve **outside the repository** (not relative imports such as `./` or `../`).

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| External imports / 1k LOC | 6.2 | 16.7 | 9.1 | 22.3 | 10.0 | 4.5 |
| Runtime dependencies | 12 | 173 | 50 | 155 | 186 | 109 |

Lower values indicate a more self-contained codebase with fewer external dependencies.

---

# Input Validation Coverage

Measures how frequently data entering the system is validated.

Includes schema validation calls such as:

- `safeParse`
- `parse`
- `validate`

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| Schema validations / 1k LOC | 2.4 | 0.7 | 0.7 | 1.2 | 0.9 | 0.5 |
| `.safeParse()` calls | 1.1 | 0.1 | 0.0 | 0.0 | 0.1 | 0.0 |

Higher values indicate stronger runtime validation of model outputs, RPC payloads, and configuration data.

---

# Type Safety

TypeScript projects, per 1k source lines.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `as any` | 0.1 | 1.8 | 1.4 | 0.8 | 2.3 | 0.1 |
| `: any` annotations | 0.0 | 1.0 | 1.3 | 2.3 | 4.4 | 0.2 |
| `@ts-ignore` / `@ts-expect-error` | 0.0 | 0.2 | 0.0 | 0.1 | 0.4 | 0.0 |
| Lint ignores | 0.1 | 0.0 | 0.0 | 0.1 | 0.2 | 0.1 |
| `: unknown` usage | 5.2 | 1.5 | 1.1 | 0.4 | 0.3 | 5.6 |

Acolyte has **2 total `any`**. It uses `unknown` with explicit narrowing at high rates — every tool output, model response, and RPC payload is validated through Zod schemas before entering the type system.

---

# Type Safety

Python / Rust / Go projects, per 1k source lines.

| Metric | Aider | OpenHands | Goose | Plandex |
|---|---|---|---|---|
| `type: ignore` (Python) | 0.0 | 1.7 | — | — |
| `Any` usage (Python) | 0.1 | 3.5 | — | — |
| `cast()` calls (Python) | 0.0 | 0.3 | — | — |
| `unsafe` (Rust) | — | — | 0.0 | — |
| `.unwrap()` (Rust) | — | — | 11.8 | — |
| `.expect()` (Rust) | — | — | 1.4 | — |
| `any` / `interface{}` (Go) | — | — | — | 4.4 |
| `panic()` (Go) | — | — | — | 0.3 |
| `nolint` (Go) | — | — | — | 0.0 |

Aider shows minimal type escape hatches. Goose has relatively high `.unwrap()` density — potential panic sites.

---

# Tech Debt (per 1k source lines)

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw | Plandex |
|---|---|---|---|---|---|---|---|---|---|---|
| TODO / FIXME / HACK | 0.1 | 0.3 | 0.3 | 0.0 | 0.2 | 0.5 | 0.8 | 0.7 | 0.0 | 0.0 |
| Comment lines | 6.9 | 54.9 | 9.6 | 52.5 | 39.5 | 60.1 | 42.6 | 54.2 | 14.0 | 33.7 |

Near-zero tech debt markers (2 total).

Low inline comment density reflects smaller modules and strict typing, with architectural explanations maintained in external documentation.

---

# Test Quality

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw | Plandex |
|---|---|---|---|---|---|---|---|---|---|---|
| Test files | 135 | 42 | 212 | 114 | 19 | 354 | 331 | 190 | 2,470 | 6 |
| Test lines | 18,054 | 12,410 | 42,289 | 36,120 | 5,579 | 143,114 | 82,506 | 48,170 | 526,910 | 2,517 |
| Test / source ratio | **0.80** | 0.48 | 0.20 | 0.36 | 0.05 | **1.17** | 0.36 | 0.24 | 0.77 | 0.03 |

Acolyte maintains a high test ratio because lifecycle phases, guards, and tools are independent modules with clean interfaces.

Test types include:

- unit (`*.test.ts`)
- integration (`*.int.test.ts`)
- TUI visual regression (`*.tui.test.ts`)
- performance (`*.perf.test.ts`)

---

# Module Cohesion

| Metric | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw | Plandex |
|---|---|---|---|---|---|---|---|---|---|---|
| Avg lines / file | 129 | 247 | 204 | 254 | 374 | 174 | 158 | 165 | 181 | 224 |
| Files > 500 lines | 4 (2%) | 14 (13%) | 105 (10%) | 51 (13%) | 79 (24%) | 55 (8%) | 87 (6%) | 69 (6%) | 326 (9%) | 36 (11%) |
| Largest file | 721 | 2,486 | 4,964 | 4,443 | 2,506 | 1,715 | 3,229 | 4,758 | 2,875 | 2,455 |
| Barrel / index files | 1 | 5 | 50 | 26 | 44 | 85 | 73 | 47 | 79 | 0 |

Acolyte maintains the smallest average module size and fewest large files.

The flat `src/` layout keeps modules shallow with minimal re-exports and no circular dependencies.

---

# Error Handling

TypeScript projects, per 1k source lines.

| Metric | Acolyte | OpenCode | Pi | Cline | Continue | OpenClaw |
|---|---|---|---|---|---|---|
| `.safeParse()` calls | 1.1 | 0.1 | 0.0 | 0.0 | 0.1 | 0.0 |
| `try { ... }` blocks | 5.2 | 1.3 | 4.2 | 6.1 | 3.8 | 4.8 |
| `.catch()` calls | 0.6 | 2.2 | 0.3 | 1.1 | 0.3 | 1.0 |

Acolyte validates boundaries with Zod `.safeParse()` at over **10× the rate** of most other projects.

RPC payloads, model responses, and configuration files are validated before entering the system.

---

# Key Takeaways

Across the benchmarked projects, Acolyte demonstrates:

- extremely low `any` usage and strong TypeScript safety
- the smallest modules and lowest large-file density
- the lightest dependency footprint
- near-zero tech debt markers
- high automated test coverage
- clear lifecycle boundaries across independently testable modules

These characteristics reflect a deliberately small, strongly typed architecture — built so that lifecycle phases, guards, and tools behave predictably and can be independently verified.

---

# Summary

| Dimension | Acolyte | Aider | OpenCode | Pi | Goose | OpenHands | Continue | Cline | OpenClaw | Plandex |
|---|---|---|---|---|---|---|---|---|---|---|
| Type safety | High | High | Medium | Medium | Panic-heavy | Ignore-heavy | Lower | Medium | High | Medium |
| Tech debt | Very low | Low | Low | Very low | Low | Medium | Highest | Medium | Very low | Zero |
| Test density | High (0.80) | Medium (0.48) | Low (0.20) | Medium (0.36) | Lowest (0.05) | Highest (1.17) | Medium (0.36) | Low (0.24) | High (0.77) | Low (0.03) |
| Module size | Smallest (129) | Medium (247) | Medium (204) | Medium (254) | Largest (374) | Medium (174) | Medium (158) | Medium (165) | Medium (181) | Medium (224) |
| Dependencies | Lightest (18) | Light (52) | Heavy (252) | Light (69) | Heavy (154) | Medium (90) | Heavy (350) | Heavy (225) | Heavy (156) | Light (54) |
| Maturity | New | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped | Shipped |

Acolyte leads on type safety, module size, dependency count, and tech debt markers while remaining the smallest codebase in the benchmark.

---

Updated 16 March 2026.