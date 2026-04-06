# Acolyte

[![CI](https://img.shields.io/github/actions/workflow/status/cniska/acolyte/ci.yml?style=flat&label=ci)](https://github.com/cniska/acolyte/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/cniska/acolyte?style=flat)](https://github.com/cniska/acolyte)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-f9f1e1?style=flat)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?style=flat)](https://www.typescriptlang.org)

An open-source, terminal-first AI coding agent with a single-pass lifecycle, on-demand memory, and transparent execution. Every decision visible, every behavior overridable.

![Acolyte CLI](docs/assets/cli.png)

## Install

```bash
curl -fsSL https://acolyte.sh/install | sh
```

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
