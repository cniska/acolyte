# Contributing

Minimal workflow for external contributors.

## Prerequisites

- Bun 1.3+
- One provider API key for local chat testing (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`)

## Setup

```bash
bun install
bun run client init
```

## Development loop

1. Create a branch from `main`.
2. Make focused changes.
3. Run targeted checks while iterating:
   - `bun run test:unit`
   - `bun run test:int`
   - `bun run test:tui`
   - `bun run test:perf`
4. Before opening a PR, run full validation:

```bash
bun run verify
```

## Submission expectations

- Keep PRs small and scoped to one intent.
- Update canonical docs when behavior or contracts change.
- Include tests for meaningful regression risk.
