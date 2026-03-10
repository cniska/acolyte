# Acolyte

CLI-first AI coding agent with a headless daemon, typed RPC protocol, and an explicit lifecycle pipeline.

![Acolyte CLI](docs/assets/cli.png)

## Why Acolyte

- **Daemon architecture.** The server runs headless. CLI, editor plugins, and custom clients connect over the same typed RPC protocol. The TUI is just another client.
- **Lifecycle pipeline.** Every request flows through five explicit phases: classify → prepare → generate → evaluate → finalize. Each phase is a separate module with its own tests.
- **Tool guards.** Behavioral guards detect and block degenerate model patterns at runtime — duplicate calls, file churn loops, redundant searches, and more.
- **Auto-verification.** Evaluators inspect generation output and can trigger re-generation, mode transitions, or verify cycles without manual intervention.
- **Extension seams.** Every core system — lifecycle, tools, guards, memory, transport — exposes clean contracts for customization without a plugin runtime.
- **Small surface.** Minimal source, few runtime dependencies, high test/source ratio, small files, zero barrel files. See [benchmarks](docs/benchmarks.md).

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

The developer tooling — lifecycle trace, benchmarks, performance scenarios — was built by agents using Acolyte itself.

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
