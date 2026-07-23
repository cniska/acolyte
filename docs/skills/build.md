---
name: build
description: Implement features incrementally through vertical slices. Use when building features, adding functionality, or implementing tasks that touch multiple files.
---

# Build

Build in thin vertical slices. Implement one piece, verify it, and commit it when commits are in scope. Never accumulate uncommitted work across multiple files.

## Workflow

1. **Pick the smallest slice** that delivers a complete, testable path through the change.
2. **Read before writing.** Load the relevant files, understand existing patterns, check for utilities you can reuse. For external libraries and version-sensitive APIs, confirm behavior against the docs or upstream source for the version pinned in this repo — not memory, not blog posts (`web-fetch`/`web-search`).
3. **Implement the slice.** Stay within its boundary — don't fix adjacent issues or refactor unrelated code.
4. **Verify the slice.** Run the targeted tests (`test-run`), then the project's full verification. The build must pass after every slice.
5. **Commit the slice (only if commits are in scope, via `git-add`/`git-commit`).** One logical change per commit.
6. **Repeat.** Mark the finished slice done with `tasklist-update` if the plan left a tasklist. If commits are not in scope, pause after each verified slice and ask before starting the next one.

## Slicing strategies

- **Vertical slice** — one complete path through the stack (type + implementation + test). Preferred default.
- **Contract-first** — define the schema and types first, then implement consumers.
- **Risk-first** — tackle the uncertain part first, then build the straightforward parts on top.

A slice is one path, not one layer. Good: `POST /orders` endpoint + the form that calls it + one test. Bad: all endpoints, then all UI, then all tests.

## See also

- `plan` for scope and phase boundaries
- `tdd` for red-green-refactor within each slice

## Red flags

- More than 3 files changed without a commit
- Tests haven't run since the last significant change
- Mixing refactoring with feature work in the same slice
- Expanding scope mid-slice instead of deferring to the next one
- "I'll commit it all at the end"
- Implementing a version-sensitive API from memory
