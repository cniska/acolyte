# Tooling

Tool execution is layered and contract-driven:

```text
lifecycle → guard → cache → toolkit → registry
```

## Layers

- **guard**: pre-execution checks and post-execution call recording.
- **toolkit**: domain tool definitions (`file-toolkit`, `code-toolkit`, `git-toolkit`, `shell-toolkit`, `web-toolkit`).
- **registry**: permission filtering and agent-facing tool surface.

## Guarded execution

All tool calls run through guarded execution paths to ensure:

- Policy enforcement
- Consistent error shaping
- Call recording for evaluators/debug

## File discovery

`collectWorkspaceFiles` determines what files are in scope for `find-files` and `search-files`. Three exclusion layers apply in order:

1. **`IGNORED_DIRS`** — always excluded regardless of `.gitignore`: `node_modules`, `.git`, `.acolyte`
2. **`.gitignore`** — workspace-root and nested `.gitignore` files are parsed and applied per-directory during traversal
3. Nothing else is excluded by default — hidden directories and files are visible unless covered by the above

Entries in `IGNORED_DIRS` take precedence and cannot be re-included by gitignore negation patterns.

## Tool result cache

Read-only and search tools (`read-file`, `find-files`, `search-files`, `scan-code`) are cached per-task. Identical calls return the cached result without re-executing.

- **Key**: deterministic `toolName:stableJSON(args)` — object keys sorted for stability
- **Invalidation**: write tools (`edit-file`, `create-file`, `delete-file`) evict entries with overlapping paths; `run-command` clears the entire cache
- **Scope**: one cache per task, discarded when the task ends
- **Eviction**: LRU (least recently used) with a default cap of 256 entries

This reduces redundant I/O and avoids re-sending identical tool results to the model.

## Query vs mutation tools

Tools are divided into two categories with fundamentally different design constraints.

**Query tools** (`read-file`, `find-files`, `search-files`, `scan-code`) are read-only and exploratory. Their contracts should be simple and discoverable — the caller is asking *“show me what’s there.”* Input schemas should reflect the user's mental model of searching, not the engine's internal capabilities.

**Mutation tools** (`edit-file`, `create-file`, `delete-file`, `edit-code`) change workspace state. Their contracts can be more expressive because precise targeting matters — the cost of a wrong match is a bad edit.

The key principle: **do not unify query and mutation contracts just because they share an implementation.**  
A scan tool and an edit tool may both use ast-grep internally, but their input models serve different purposes and should be designed independently. Leaking mutation rule language into query tools couples them unnecessarily and complicates the caller’s mental model.

Practical implications:

- Query tools get their own simpler vocabulary even if a richer one exists internally
- Mutation tools may expose scoping constraints (e.g. `withinSymbol`, `within`) that narrow where the edit applies — these are targeting aids, not a query language
- New capabilities in the underlying engine (e.g. new ast-grep rule types) should be evaluated **separately for query and mutation exposure**

Internal implementations may share compilers, rule objects, or AST helpers, but these should remain implementation details.

## Extension seams

- Add tools by extending toolkit modules.
- Add guard behavior in `src/tool-guards.ts`.
- Keep tool contracts stable and enforce with schema-first inputs.

## Key files

- `src/gitignore.ts`
- `src/file-toolkit.ts`
- `src/code-toolkit.ts`
- `src/git-toolkit.ts`
- `src/tool-registry.ts`
- `src/tool-guards.ts`
- `src/tool-cache.ts`
