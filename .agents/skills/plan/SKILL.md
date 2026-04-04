---
name: plan
description: Design a feature or behavior change through dialogue. Use when asked to plan, scope, design, or break down work before coding.
---

If an issue number is given, fetch it with `gh issue view $ARGUMENTS` and use it as the starting point.

Have a design conversation about this task. Read the relevant code, share what you find, say what you think, and let the user shape the direction. The plan emerges from the dialogue — do not build it in isolation.

If a question can be answered by reading the code, read the code instead of asking.

Ground every recommendation in current code, docs, and project rules. Read `AGENTS.md` and `docs/architecture.md` before forming opinions.

## Acolyte checks

- Tools must flow through `runTool`
- New payloads and contracts validated with Zod
- Model output must preserve the `@signal` contract
- TUI state reads must use functional updaters
- Chat-layer code must use approved effect helpers, not direct `useEffect`
- Shared string unions start as Zod schemas

## Task sizing

- **Small (1-2 files):** single endpoint, component, or utility
- **Medium (3-5 files):** one feature slice through the stack
- **Large (5-8 files):** multi-component feature — consider splitting

Anything larger needs further decomposition. Slice vertically (complete paths through the stack), not horizontally (all types, then all implementations, then all tests).

## When aligned

Summarize what was agreed: **Outcome** | **Decisions made** | **Change list** | **Validation** | **Open questions**.

Split into phases if the work is large. Each phase independently valuable and verifiable. Reference concrete files.

For non-trivial plans, create a checklist early with `checklist-create` and add items one at a time as each step gets agreed. When planning is done, the checklist is ready — start executing.

## Red flags

- Disappearing to build a plan and returning with a document for approval
- Presenting options instead of surfacing the underlying problem
- Planning from intuition without reading current code
- Hiding uncertainty instead of stating assumptions

Do not implement inside this skill flow unless the user explicitly switches to execution.
