# Tooling

Tool execution is layered and contract-driven:

```text
lifecycle -> guard -> toolkit -> registry
```

## Layers

- **guard**: pre-execution checks and post-execution call recording.
- **toolkit**: domain tool definitions (`core-toolkit`, `git-toolkit`).
- **registry**: permission filtering and agent-facing tool surface.

## Guarded execution

All tool calls run through guarded execution paths to ensure:

- policy enforcement
- consistent error shaping
- call recording for evaluators/debug

## Extension seams

- Add tools by extending toolkit modules.
- Add guard behavior in `src/tool-guards.ts`.
- Keep tool contracts stable and enforce with schema-first inputs.

## Key files

- `src/core-toolkit.ts`
- `src/git-toolkit.ts`
- `src/tool-registry.ts`
- `src/tool-guards.ts`
