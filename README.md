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
OPENAI_API_KEY=your_key bun run serve
```

3. In a second shell, run CLI against backend:
```bash
ACOLYTE_API_URL=http://localhost:8787 bun run chat
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

Optional auth:
```bash
ACOLYTE_API_KEY=dev-secret bun run serve
ACOLYTE_API_URL=http://localhost:8787 ACOLYTE_API_KEY=dev-secret bun run chat
```

Health endpoint:
```bash
curl http://localhost:8787/healthz
```
