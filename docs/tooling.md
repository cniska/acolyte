# Tooling

Tool execution is layered and contract-driven:

```text
lifecycle -> guard -> cache -> toolkit -> registry
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

## Tool result cache

Read-only and search tools (`read-file`, `find-files`, `search-files`, `scan-code`) are cached per-task. Identical calls return the cached result without re-executing.

- **Key**: deterministic `toolName:stableJSON(args)` — object keys sorted for stability
- **Invalidation**: write tools (`edit-file`, `create-file`, `delete-file`) evict entries with overlapping paths; `run-command` clears the entire cache
- **Scope**: one cache per task, discarded when the task ends
- **Eviction**: LRU with a default cap of 256 entries

This reduces redundant I/O and avoids re-sending identical tool results to the model.

## Extension seams

- Add tools by extending toolkit modules.
- Add guard behavior in `src/tool-guards.ts`.
- Keep tool contracts stable and enforce with schema-first inputs.

## Key files

- `src/file-toolkit.ts`
- `src/git-toolkit.ts`
- `src/tool-registry.ts`
- `src/tool-guards.ts`
- `src/tool-cache.ts`
