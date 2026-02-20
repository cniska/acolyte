# Acolyte

My personal AI assistant.

## Local Development

1. Install dependencies:
```bash
bun install
```

2. Start local backend:
```bash
bun run serve
```
With real model responses:
```bash
bun run serve:env
```

3. In a second shell, run CLI against backend:
```bash
ACOLYTE_API_URL=http://localhost:8787 bun run chat
```
One-command interactive test (starts backend + opens chat):
```bash
bun run chat:test
```
Check connectivity:
```bash
ACOLYTE_API_URL=http://localhost:8787 bun run src/cli.ts status
```

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
- `/sessions` to list saved sessions
- `/use <session-id-prefix>` to switch sessions
- `/title <text>` to rename current session
- `/file <path>` to attach a local text/code file as context
- `/search <pattern>` to search repository content
- `/read <path> [start] [end]` to inspect file snippets

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
bun run tool test "bun run typecheck"
bun run tool edit src/cli.ts Acolyte Acolyte --dry-run
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
