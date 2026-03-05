# Getting Started

Minimal developer setup and first-run workflow for local iteration.

## Install

```bash
bun install
```

## Initialize

```bash
bun run client init
```

This stores one provider API key in local `.env`.

## Run

```bash
bun run dev
```

This starts server watch mode and opens the CLI client for local development.

## Dev checks

- `bun run client help`
- `bun run verify`

## Core docs

- [configuration.md](./configuration.md)
- [cli.md](./cli.md)
- [memory.md](./memory.md)
- [architecture.md](./architecture.md)
