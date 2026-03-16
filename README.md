# Acolyte

[![CI](https://img.shields.io/github/actions/workflow/status/cniska/acolyte/ci.yml?style=flat&label=ci)](https://github.com/cniska/acolyte/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/cniska/acolyte?style=flat)](https://github.com/cniska/acolyte)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-f9f1e1?style=flat)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?style=flat)](https://www.typescriptlang.org)

A terminal-first AI coding agent: reliable by default, observable, and open source.

![Acolyte CLI](docs/assets/cli.png)

## Quick start

```bash
bun install
bun run start init   # prompts for provider API key, writes .env
bun run dev           # starts server + CLI client
```

See all commands: `bun run start help`

## Validate

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
