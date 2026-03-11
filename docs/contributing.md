# Contributing

Minimal workflow for external contributors.

## Setup

See [getting-started.md](./getting-started.md) for prerequisites and initial setup.

## Development loop

1. Create a branch from `main`.
2. Make focused changes.
3. Run targeted checks while iterating:

```bash
bun run test:unit     # unit tests
bun run test:int      # integration tests
bun run test:tui      # visual regression tests
bun run test:perf     # performance baselines
```

4. Before opening a PR, run full validation:

```bash
bun run verify
```

## Submission expectations

- Keep PRs small and scoped to one intent.
- Update canonical docs when behavior or contracts change.
- Include tests for meaningful regression risk.
