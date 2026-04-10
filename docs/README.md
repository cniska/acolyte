# Documentation

Developer documentation for Acolyte, a terminal-first AI coding agent. Reliable by default, observable, and open source.

## Overview

- [Features](./features.md) — shipped, user-visible capabilities
- [Why Acolyte](./why-acolyte.md) — observable execution and full developer control over AI coding
- [Comparison](./comparison.md) — how Acolyte compares to other AI coding agents
- [Benchmarks](./benchmarks.md) — measured code quality comparisons across agents
- [Soul](./soul.md) — product persona and operating principles

## Architecture

- [Architecture](./architecture.md) — headless daemon with typed RPC connecting CLI, editors, and custom clients
- [Workspace](./workspace.md) — workspace root resolution, sandboxing, and profile behavior
- [Lifecycle](./lifecycle.md) — how each task flows through resolve, prepare, generate, and finalize
- [Errors](./errors.md) — error contracts and runtime classes

## Runtime

- [TUI](./tui.md) — React terminal UI with fuzzy search, autocomplete, model picker, and code editing
- [Tooling](./tooling.md) — layered tool execution with contracts and effects
- [Sessions](./sessions.md) — chat context, message history, and session storage backends
- [Tasks](./tasks.md) — task lifecycle, queue policy, and state transitions
- [Memory](./memory.md) — structured facts persisted across session, project, and user tiers
- [Cloud](./cloud.md) — portable agent identity via cloud-hosted memory and sessions

## Development

- [Skills](./skills/README.md) — engineering workflows for plan, build, and review
- [Testing](./testing.md) — test types, naming, and execution

## Reference

- [CLI](./cli.md) — commands for chat, run, server, memory, config, logs, and trace
- [Configuration](./configuration.md) — settings for models, providers, memory, permissions, and runtime behavior
- [Protocol](./protocol.md) — transport-facing contract between client and server
- [Localization](./localization.md) — translatable copy separated from protocol contracts
- [Updates](./updates.md) — versioning, auto-update, and breaking change policy
- [Glossary](./glossary.md) — core terminology for sessions, tasks, phases, and effects