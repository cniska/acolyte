---
name: simplify
description: Simplify code by reducing complexity while preserving exact behavior.
---

# Simplify

Reduce complexity while preserving exact behavior. The goal is not fewer lines — it's code that is easier to read, understand, and modify. Every simplification must pass: "Would a new contributor understand this faster than the original?"

Do not simplify code you don't understand yet, code that is already clean, or code you're about to rewrite entirely.

## Workflow

### 1. Understand before touching (Chesterton's Fence)

Before changing or removing anything, understand why it exists. Check git blame, read the context, understand the reason. Then decide if the reason still applies.

### 2. Identify opportunities

- **Deep nesting (3+ levels)** — extract guard clauses or helpers
- **Long functions (50+ lines)** — split by responsibility
- **Nested ternaries** — replace with if/else or lookups
- **Generic names** (`data`, `result`, `temp`) — rename to describe content
- **Duplicated logic** — extract to shared function (rule of 3)
- **Dead code** — remove after confirming truly unreachable
- **Wrappers that add no policy** — inline them

### 3. Apply incrementally

One simplification at a time. Run tests after each change. If tests fail, revert and reconsider. Separate refactoring from feature work.

### 4. Verify

All existing tests must pass without modification — if tests needed updating, you likely changed behavior. The diff should be clean with no unrelated changes mixed in.

## Red flags

- Simplification that requires modifying tests to pass (likely changed behavior)
- "Simplified" code that is longer or harder to follow than the original
- Removing error handling because "it makes the code cleaner"
- Simplifying code you don't fully understand
- Batching many simplifications into one large commit
