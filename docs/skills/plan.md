---
name: plan
description: Design a feature or behavior change through dialogue. Use when asked to plan, scope, design, or break down work before coding.
---

# Plan

Design a feature or behavior change through dialogue.

If an issue number is given, fetch it with `gh issue view $ARGUMENTS` and use it as the starting point.

Have a design conversation about this task. Read the relevant code, share what you find, say what you think, and let the user shape the direction. The plan emerges from the dialogue — do not build it in isolation.

If a question can be answered by reading the code, read the code instead of asking. When scope is genuinely ambiguous, resolve it before drafting: ask one question at a time, in dependency order, each with your recommended answer — and only ask what the code can't tell you.

Ground every recommendation in current code, docs, and project rules. For non-trivial context gathering, read the load-bearing files, then bring what you found back to the user before drafting — the read-back is a conversation turn, not a silent research phase.

## Task sizing

- **Small (1-2 files):** single endpoint, component, or utility
- **Medium (3-5 files):** one feature slice through the stack
- **Large (5-8 files):** multi-component feature — consider splitting

Anything larger needs further decomposition. Slice vertically (complete paths through the stack), not horizontally (all types, then all implementations, then all tests).

## When aligned

Aligned means the user has explicitly agreed to a concrete proposal — not merely heard it. If you haven't gotten a confirming response, you're not aligned yet.

Summarize what was agreed: **Outcome** | **Decisions made** | **Change list** | **Validation** | **Open questions**. Record decisions that should outlast the session with `memory-add`.

Split into phases if the work is large. Each phase independently valuable and verifiable. Reference concrete files.

For non-trivial plans, track agreed steps in a checklist (`checklist-create`) as the conversation progresses. When planning is done, the checklist is ready — hand it to the user and stop. Execution starts only when the user says so (typically via `build`).

## See also

- `build` for execution discipline per slice

## Red flags

- Disappearing to build a plan and returning with a document for approval
- Presenting options instead of surfacing the underlying problem
- Planning from intuition without reading current code
- Hiding uncertainty instead of stating assumptions

Do not implement inside this skill flow unless the user explicitly switches to execution.
