# Acolyte

![Acolyte logo](src/assets/acolyte.png)

Acolyte is a chat-first coding agent with an explicit lifecycle, tool guards, evaluators, and context distillation memory.

## Dev Setup

```bash
bun install
bun run client init
```

This command prompts for one provider API key and writes it to local `.env`.

Start the development chat workflow:

```bash
bun run dev
```

`bun run dev` starts server watch mode and opens the CLI client.

See all client commands:

```bash
bun run client help
```

## Validate Changes

- Full check: `bun run verify`
- Unit coverage report: `bun run test:coverage`
- Integration tests: `bun run test:int`
- Perf baseline: `bun run test:perf`

## Documentation

- Getting started: [`docs/getting-started.md`](docs/getting-started.md)
- Configuration: [`docs/configuration.md`](docs/configuration.md)
- CLI: [`docs/cli.md`](docs/cli.md)
- Memory: [`docs/memory.md`](docs/memory.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Protocol: [`docs/protocol.md`](docs/protocol.md)
- Domain language: [`docs/glossary.md`](docs/glossary.md)
- FAQ: [`docs/faq.md`](docs/faq.md)
- Testing strategy: [`docs/testing.md`](docs/testing.md)
- Feature inventory: [`docs/features.md`](docs/features.md)
- Direction and milestones: [`docs/roadmap.md`](docs/roadmap.md)
- Agent policy: [`AGENTS.md`](AGENTS.md)
