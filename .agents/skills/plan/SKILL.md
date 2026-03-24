---
name: plan
description: Draft implementation plans for new features or substantial behavior changes. Use when asked to plan, scope, design, or break down a feature before coding.
---

# Plan

Plan before editing. Produce a plan another coding agent can execute without rediscovering the system.

Ground every recommendation in the current codebase, docs, and project rules.

## Workflow

1. Fetch the issue with `gh issue view $ARGUMENTS` if an issue number is given.
2. Read `AGENTS.md`, `docs/architecture.md`, `docs/features.md`, `docs/roadmap.md`, then source files related to the feature.
3. **Define the outcome**: user-visible behavior, goals, non-goals, constraints, assumptions.
4. **Build context from evidence**: read existing code paths, contracts, guards, evaluators, and TUI surfaces the feature would touch.
5. **Find the canonical owner**: put behavior in the boundary that already owns it. Prefer contract fixes over host-side patches.
6. **Shape the smallest end-to-end slice**: list files that change and why. Call out new schemas, commands, lifecycle seams, docs, and tests.
7. **Plan validation**: lightest checks that prove the change, final gate, regression tests, manual smoke only when automated proof is not enough.
8. **Surface risks**: edge cases, migration concerns, reversibility.

## Acolyte checks

- Tools must flow through `runTool`
- New payloads and contracts validated with Zod
- Model output must preserve the `@signal` contract
- TUI state reads must use functional updaters
- Chat-layer code must use approved effect helpers, not direct `useEffect`
- Shared string unions start as Zod schemas

## Output

Sections: **Outcome** | **Current-state evidence** | **Proposed design** | **Change list** | **Validation** | **Risks and open questions**.

Split change list into phases if the work is large. Each phase independently valuable. Reference concrete files.

## Anti-patterns

- Planning from intuition without reading current code
- Broad refactors when a smaller canonical change exists
- Vague validation
- Hiding uncertainty instead of stating assumptions
- Task lists without explaining why the chosen boundary is correct

Do not implement inside this skill flow unless the user explicitly switches to execution.
