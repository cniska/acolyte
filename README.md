# Acolyte

A terminal-first AI coding assistant: local-first, observable, and built for extension.

![Acolyte CLI](docs/assets/cli.png)

## Quick Start

```bash
bun install
bun run client init   # prompts for provider API key, writes .env
bun run dev           # starts server + CLI client
```

See all commands: `bun run client help`

## Architecture

```
CLI → client → server → lifecycle → model + tools
```

The server accepts requests over RPC, queues them, and runs each through the lifecycle pipeline. Tools execute inside guards. Evaluators decide whether to accept, retry, or re-generate. The client renders structured output.

See [docs/architecture.md](docs/architecture.md) for the full system map.

## Validate

```bash
bun run verify        # format + lint + typecheck + all tests
bun test              # all tests
bun run test:unit     # unit tests only
bun run test:int      # integration tests
bun run test:tui      # visual regression tests
bun run test:perf     # performance baselines
```

## Docs

- [Documentation home](docs/index.md)
- [Why Acolyte](docs/why-acolyte.md)
- [Getting started](docs/getting-started.md)
- [Contributing](docs/contributing.md)
- [Benchmarks](docs/benchmarks.md)
- [Agent policy](AGENTS.md)

## License

[MIT](LICENSE)
