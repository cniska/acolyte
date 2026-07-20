# Contributing

Contributions are welcome. See [Local development](./README.md#local-development) to run Acolyte locally, then follow this workflow when proposing a change on GitHub.

## Workflow

1. Read [AGENTS.md](AGENTS.md) before changing an unfamiliar subsystem.
2. Create a branch from `main`.
3. Keep the change scoped to one intent.
4. Add or update regression tests when the change carries meaningful regression risk.
5. Update canonical docs when behavior or contracts change.

## Validation

Run the [narrow relevant test suite](./README.md#testing) while iterating. Before opening a pull request, run the [full validation](./README.md#testing).

`bun install` installs the pre-push hook, which runs the same validation before every push.

## Pull requests

Follow the pull request requirements in [AGENTS.md](AGENTS.md). Keep the description focused on the motivation and user-visible outcome; do not include mechanical implementation detail.
