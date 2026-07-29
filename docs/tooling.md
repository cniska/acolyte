# Tooling

Acolyte routes every tool call through a layered execution path that enforces budgets, shapes errors, and records execution.

```text
lifecycle → budget → toolkit → registry
```

## Layers

- **budget** — step-budget check (`checkStepBudget()`) inlined into tool execution
- **toolkit** — domain tool definitions (see table below)
- **registry** — tool registration and agent-facing tool surface

## Toolkits

| Toolkit | Purpose |
|---------|---------|
| `file` | File operations |
| `code` | AST-aware code scanning and editing |
| `undo` | Revert file edits |
| `session` | Search current session history |
| `memory` | Persistent cross-session knowledge |
| `skill` | Skill activation and deactivation |
| `test` | Run workspace tests |
| `tasklist` | Multi-step task tracking |
| `gh` | GitHub issue and pull request operations |
| `git` | Version control |
| `web` | External information retrieval |
| `shell` | Shell command execution |

## Tool execution

All tool calls run through the execution layer which ensures:

- step-budget enforcement
- consistent error shaping
- call recording for effects/debug

## File discovery

`collectWorkspaceFiles` determines what files are in scope for `file-find` and `file-search`. Three exclusion layers apply in order:

1. **`IGNORED_DIRS`** — always excluded regardless of `.gitignore`: `node_modules`, `.git`, `.acolyte`
2. **`.gitignore`** — workspace-root and nested `.gitignore` files are parsed and applied per-directory during traversal
3. Nothing else is excluded by default — hidden directories and files are visible unless covered by the above

Entries in `IGNORED_DIRS` take precedence and cannot be re-included by gitignore negation patterns.

`file-find` matches a pattern against workspace-relative paths through `createPathMatcher` in `glob-match.ts` — a glob when the pattern has a wildcard, a substring when it does not. A trailing slash searches beneath matching directories. `gitignore.ts` shares the same glob compiler, so brace alternation is expanded outside it: git treats braces literally. File discovery retains at most 5,000 paths; when that cap withholds matches, `file-find` reports the shown count as a lower bound. Its result cap reports the full match count. An explicitly named file is searched even when gitignored; only directory and workspace scans apply the exclusion layers.

## File reading

`file-read` returns the whole file as numbered lines under a `Lines: start-end of total` header. The total counts lines holding content, and those line numbers are what `file-edit` accepts for line-range edits.

Two ceilings bound a read, and they differ in the caller's remedy. `FILE_READ_MAX_BYTES` (5 MB) is checked by a `stat` before the read; a file over it is readable at no range and has to be searched instead. `FILE_READ_MAX_TOKENS` (20,000) is checked on the formatted output; a file over it is re-readable with `offset` and `limit`. Both throw a structured error naming the measured size rather than truncating.

A log file is the case that separates them:

| Log size | How the content is reached |
|----------|---------------------------|
| under the token ceiling | one whole-file read |
| over the token ceiling, under the byte ceiling | the failed read reports the file's line count, which is what `offset` needs to reach the tail |
| over the byte ceiling | `file-search` with the path |

## Query vs mutation tools

Tools are divided into two categories with fundamentally different design constraints.

**Query tools** (`file-read`, `file-find`, `file-search`, `code-scan`) are read-only and exploratory. Their contracts should be simple and discoverable — the caller is asking *"show me what's there."* Input schemas should reflect the user's mental model of searching, not the engine's internal capabilities.

**Mutation tools** (`file-edit`, `file-create`, `file-delete`, `code-edit`) change workspace state. Their contracts can be more expressive because precise targeting matters — the cost of a wrong match is a bad edit.

The key principle: **do not unify query and mutation contracts just because they share an implementation.**
A scan tool and an edit tool may both use ast-grep internally, but their input models serve different purposes and should be designed independently. Leaking mutation rule language into query tools couples them unnecessarily and complicates the caller's mental model.

Practical implications:

- query tools get their own simpler vocabulary even if a richer one exists internally
- mutation tools may expose scoping constraints (e.g. `withinSymbol`, `within`) that narrow where the edit applies — these are targeting aids, not a query language
- new capabilities in the underlying engine (e.g. new ast-grep rule types) should be evaluated **separately for query and mutation exposure**

Internal implementations may share compilers, rule objects, or AST helpers, but these should remain implementation details.

## Extension seams

- add tools by extending toolkit modules
- keep tool contracts stable and enforce with schema-first inputs

## Key files

- `src/gitignore.ts` — gitignore pattern compilation and evaluation
- `src/file-toolkit.ts` — file operations (read, write, find, search, edit)
- `src/code-toolkit.ts` — code manipulation for scanning and editing source files
- `src/git-toolkit.ts` — git operations (status, diff, log, show, add, commit)
- `src/tool-registry.ts` — tool registration and agent-facing surface
- `src/tool-contract.ts` — session context (`SessionContext`), tool result types, and shared tool contracts
- `src/tool-session.ts` — session factory, call recording, and step-budget check
- `src/tool-execution.ts` — tool execution with budget enforcement and error shaping

## Further reading

[Edit the Tree](https://crisu.me/blog/edit-the-tree) — AST-based code editing and scanning
