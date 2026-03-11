# Acolyte

A terminal-first AI coding assistant: local-first, observable, and built for extension.

![Acolyte CLI](docs/assets/cli.png)

## Quick Start

```bash
bun install
bun run start init   # prompts for provider API key, writes .env
bun run dev           # starts server + CLI client
```

See all commands: `bun run start help`

## Validate

```bash
bun run verify        # format + lint + typecheck + all tests
bun test              # all tests
bun run test:unit     # unit tests only
bun run test:int      # integration tests
bun run test:tui      # visual regression tests
bun run test:perf     # performance baselines
```

## Documentation

- [Index](docs/README.md)
- [Why Acolyte](docs/why-acolyte.md)
- [Getting started](docs/getting-started.md)
- [Contributing](docs/contributing.md)
- [Benchmarks](docs/benchmarks.md)
- [Agent policy](AGENTS.md)

## License

[MIT](LICENSE)
