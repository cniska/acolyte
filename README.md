# Acolyte

![Acolyte logo](src/assets/acolyte.png)

Acolyte is a chat-first coding agent with an explicit lifecycle, tool guards, and evaluators.

## Dev Setup

```bash
bun install
cp .env.example .env
```

Set at least one provider key in `.env`:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`

Start the development chat workflow:

```bash
bun run dev
```

`bun run dev` starts server watch mode and opens the CLI client.

## Validate Changes

- Full check: `bun run verify`
- Unit coverage report: `bun run test:coverage`
- Integration tests: `bun run test:int`
- Perf baseline: `bun run test:perf`

## Documentation

- Overview: [`docs/architecture.md`](docs/architecture.md)
- Testing strategy: [`docs/testing.md`](docs/testing.md)
- Feature inventory: [`docs/features.md`](docs/features.md)
- Direction and milestones: [`docs/roadmap.md`](docs/roadmap.md)
- Agent policy: [`AGENTS.md`](AGENTS.md)
