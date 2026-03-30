# Tooling

Tool execution is layered and contract-driven:

```text
lifecycle → guard → cache → toolkit → registry
```

## Layers

- **guard**: pre-execution checks and post-execution call recording
- **toolkit**: domain tool definitions (`file-toolkit`, `code-toolkit`, `git-toolkit`, `shell-toolkit`, `web-toolkit`, `checklist-toolkit`)
- **registry**: tool registration and agent-facing tool surface

## Guarded execution

All tool calls run through guarded execution paths to ensure:

- policy enforcement
- consistent error shaping
- call recording for evaluators/debug

## Workspace sandbox

Tool filesystem access is scoped to the workspace root. See [Workspace](./workspace.md) for enforcement details.

## File discovery

`collectWorkspaceFiles` determines what files are in scope for `file-find` and `file-search`. Three exclusion layers apply in order:

1. **`IGNORED_DIRS`** — always excluded regardless of `.gitignore`: `node_modules`, `.git`, `.acolyte`
2. **`.gitignore`** — workspace-root and nested `.gitignore` files are parsed and applied per-directory during traversal
3. Nothing else is excluded by default — hidden directories and files are visible unless covered by the above

Entries in `IGNORED_DIRS` take precedence and cannot be re-included by gitignore negation patterns.

## Tool result cache

Read-only and search tools (`file-read`, `file-find`, `file-search`, `code-scan`) are cached. Identical calls return the cached result without re-executing.

- **Key**: deterministic `toolName:stableJSON(args)` — object keys sorted for stability
- **Invalidation**: write tools (`file-edit`, `file-create`, `file-delete`) evict entries with overlapping paths; `shell-run` clears the entire cache
- **L1 (in-memory)**: per-task LRU with a default cap of 256 entries, discarded when the task ends
- **L2 (SQLite)**: persists path-tracked entries (`file-read`, `code-scan`) across tasks within a session in `~/.acolyte/tool.db`, cleared on session switch

This reduces redundant I/O and avoids re-sending identical tool results to the model.

## Query vs mutation tools

Tools are divided into two categories with fundamentally different design constraints.

**Query tools** (`file-read`, `file-find`, `file-search`, `code-scan`) are read-only and exploratory. Their contracts should be simple and discoverable — the caller is asking *“show me what’s there.”* Input schemas should reflect the user's mental model of searching, not the engine's internal capabilities.

**Mutation tools** (`file-edit`, `file-create`, `file-delete`, `code-edit`) change workspace state. Their contracts can be more expressive because precise targeting matters — the cost of a wrong match is a bad edit.

The key principle: **do not unify query and mutation contracts just because they share an implementation.**  
A scan tool and an edit tool may both use ast-grep internally, but their input models serve different purposes and should be designed independently. Leaking mutation rule language into query tools couples them unnecessarily and complicates the caller’s mental model.

Practical implications:

- query tools get their own simpler vocabulary even if a richer one exists internally
- mutation tools may expose scoping constraints (e.g. `withinSymbol`, `within`) that narrow where the edit applies — these are targeting aids, not a query language
- new capabilities in the underlying engine (e.g. new ast-grep rule types) should be evaluated **separately for query and mutation exposure**

Internal implementations may share compilers, rule objects, or AST helpers, but these should remain implementation details.

## Extension seams

- add tools by extending toolkit modules
- add guard behavior in `src/tool-guards.ts`
- keep tool contracts stable and enforce with schema-first inputs

## Key files

- `src/gitignore.ts` — Gitignore pattern compilation and evaluation.
- `src/file-toolkit.ts` — File operations (read, write, find, search, edit).
- `src/code-toolkit.ts` — Code manipulation for scanning and editing source files.
- `src/git-toolkit.ts` — Git operations (status, diff, log, show, add, commit).
- `src/tool-registry.ts` — Tool registration and agent-facing surface.
- `src/tool-guards.ts` — Pre-execution guards including limits and redundancy controls.
- `src/workspace-sandbox.ts` — Canonical workspace sandbox boundary and path enforcement.
- `src/tool-cache.ts` — Per-task result caching with stable key generation.

## Further reading

[Edit the Tree](https://crisu.me/blog/edit-the-tree) — AST-based code editing and scanning.
