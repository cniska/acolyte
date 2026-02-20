# Acolyte

My personal AI assistant.

## Setup Modes

- `Local-first (default)`: run everything on your machine with your own API key.
- `Hosted (planned)`: optional deploy backend + DB for centralized memory across devices (not implemented yet).

## Local-First Quickstart

1. Install dependencies:
```bash
bun install
```

2. Add model key in `.env` (recommended for real responses):
```bash
OPENAI_API_KEY=...
```

3. Start local backend:
```bash
bun run serve
```
With `.env` loaded:
```bash
bun run serve:env
```

4. In a second shell, run CLI against backend:
```bash
ACOLYTE_API_URL=http://localhost:8787 bun run chat
```
Raw CLI only (if backend already running):
```bash
bun run chat:raw
```
Check connectivity:
```bash
ACOLYTE_API_URL=http://localhost:8787 bun run src/cli.ts status
```

No deployment is required for this mode.

Personal memory notes:
```bash
bun run src/cli.ts memory add "Prefer concise commit messages"
bun run src/cli.ts memory list
```
Saved memories are automatically injected as system context in future prompts.

Local CLI config:
```bash
bun run src/cli.ts config set model gpt-5-mini
bun run src/cli.ts config set apiUrl http://localhost:8787
bun run src/cli.ts config list
```

Session management in chat:
- `?` to toggle shortcuts/help
- `/skills` to list local repo skills from `./skills/*/SKILL.md`
- `/sessions` to list recent sessions
- `/new` to start a fresh session
- `/resume <session-id-prefix>` to restore a previous session
- `/exit` to leave chat
- chat starts in a fresh session by default (clean transcript)

Attach file context in one-shot mode:
```bash
ACOLYTE_API_URL=http://localhost:8787 bun run run --file src/cli.ts "review this file"
```

Batch coding tools:
```bash
bun run tool search "createBackend"
bun run tool read src/cli.ts 1 80
bun run tool git-status
bun run tool git-diff src/cli.ts 3
bun run tool run "bun run typecheck"
bun run tool edit src/cli.ts Acolyte Acolyte --dry-run
```
For non-dry-run edits, Acolyte now prints an immediate git diff preview for the edited file.

Validation:
```bash
bun run verify
```

## Example Prompts

Inside `bun run chat`, try:

```text
?
Find where createBackend is defined and summarize what it does.
Review src/agent.ts and list the top 3 improvements.
Summarize the current architecture and the next 3 improvements.
```

One-shot examples:

```bash
bun run run "Review the current repository state and suggest top 3 technical risks."
bun run run --file src/mastra-tools.ts "Explain what tools are available and what is missing."
bun run run --verify "Apply the requested change and then validate with bun run verify."
bun run src/cli.ts dogfood "Implement the requested change and validate the repo."
```

Dogfooding workflow (recommended for transition to Acolyte-led development):
```bash
bun run src/cli.ts dogfood "Implement <task> in this repo and verify."
```

## Backend Behavior

- `/v1/chat` runs a simple agent pipeline: `plan -> execute -> review`.
- Backend loads `docs/soul.md` as the system behavior contract.
- If `OPENAI_API_KEY` is not set, backend runs deterministic mock mode.

Optional auth:
```bash
ACOLYTE_API_KEY=dev-secret bun run serve
ACOLYTE_API_URL=http://localhost:8787 ACOLYTE_API_KEY=dev-secret bun run chat
```

Health endpoint:
```bash
curl http://localhost:8787/healthz
```
