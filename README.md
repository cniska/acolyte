# Acolyte

[![CI](https://img.shields.io/github/actions/workflow/status/cniska/acolyte/ci.yml?style=flat&label=ci)](https://github.com/cniska/acolyte/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/cniska/acolyte?style=flat)](https://github.com/cniska/acolyte)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-f9f1e1?style=flat)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?style=flat)](https://www.typescriptlang.org)

An open-source, terminal-first AI coding agent with a single-pass lifecycle, on-demand memory, and transparent execution. Every decision visible, every behavior overridable.

![Acolyte CLI](docs/assets/demo.gif)

## Why Acolyte

- **Headless daemon.** One persistent daemon connects the CLI, editors, and custom clients through typed RPC.
- **Explicit lifecycle.** Four testable phases — `resolve → prepare → generate → finalize` — keep policy, tool effects, and completion rules visible at every step.
- **On-demand memory.** Scoped memory is retrieved only when needed, keeping durable context out of every prompt.
- **Autonomy with boundaries.** Works without approval prompts, while the validated workspace boundary keeps tools in scope.
- **Visible context budgeting.** Each prompt is planned before assembly, with bounded payloads and token use shown in detail.
- **Observable execution.** Structured logs and local timelines make tool calls, effects, and task progress inspectable.
- **Multi-provider.** Bring your own model provider, selected at `acolyte init`; the same lifecycle, tools, and boundaries apply across every one.
- **Agent Skills.** Extend behavior with the [SKILL.md standard](https://agentskills.io), activated by the agent or through slash commands, with multiple skills active in one session.

See [Why Acolyte](docs/why-acolyte.md) and the [Comparison](docs/comparison.md) for how it stacks up against other open-source agents.

## Code quality

Benchmarked against other open-source coding agents, Acolyte carries the fewest runtime dependencies, the smallest average module size, and near-zero `any` escapes — the smallest TypeScript codebase in the comparison. See [Benchmarks](docs/benchmarks.md) for the measured figures and methodology.

## Install

```bash
curl -fsSL https://acolyte.sh/install | sh
```

[What does this do?](scripts/install.sh)

Then initialize your provider:

```bash
acolyte init
```

## Development

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/cniska/acolyte.git
cd acolyte
bun install
bun run dev           # starts server + CLI client
```

```bash
bun run verify        # lint + typecheck + all tests
bun test              # all tests
bun run test:unit     # unit tests only
bun run test:int      # integration tests
bun run test:tui      # visual regression tests
bun run test:perf     # performance baselines
```

## Documentation

- [Index](docs/README.md)
- [Why Acolyte](docs/why-acolyte.md)
- [Contributing](CONTRIBUTING.md)
- [Benchmarks](docs/benchmarks.md)
- [Agent policy](AGENTS.md)

## License

[MIT](LICENSE)
