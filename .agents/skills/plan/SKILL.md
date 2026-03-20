---
name: plan
description: Draft implementation plans for new features or substantial behavior changes in Acolyte. Use when the user asks to plan, scope, design, spec, break down, or de-risk a feature before coding, including requests for phased rollout, architecture touchpoints, file-level change lists, validation strategy, or open questions.
---

# Plan

Plan before editing. Produce a plan another coding agent can execute without rediscovering the system.

Ground every recommendation in the current codebase, docs, and project rules.

## Feature Request

Fetch the issue with `gh issue view $ARGUMENTS` and use its title and body as the feature request to plan.

## Read First

- `AGENTS.md`
- `docs/architecture.md`
- `docs/features.md`
- `docs/roadmap.md`
- `docs/testing.md`

Then read only the docs and source files directly related to the requested feature.

## Workflow

1. Define the outcome.
   - State the user-visible behavior.
   - Separate goals, non-goals, and constraints.
   - If the request is vague, state the assumptions the plan depends on.

2. Build context from evidence.
   - Read the existing docs for the subsystem.
   - Read the current code paths, contracts, prompts, guards, evaluators, and TUI surfaces the feature would touch.
   - Verify extension points and invariants before suggesting changes.

3. Find the canonical owner.
   - Put behavior in the boundary that already owns it.
   - Prefer contract fixes over host-side classification patches when both could solve the problem.
   - Avoid transitional architecture, duplicate sources of truth, and speculative abstractions.

4. Shape the smallest end-to-end slice.
   - Prefer a vertical slice that proves the feature works.
   - List the files or modules that should change and why each one changes.
   - Call out new schemas, commands, lifecycle seams, docs, and tests explicitly.

5. Plan validation from the start.
   - Choose the lightest checks that prove the planned change while iterating.
   - Include the final validation gate.
   - Add regression tests when the feature could fail silently.
   - Include manual smoke coverage only when automated proof is not enough.

6. Surface risks and open questions.
   - Identify edge cases, migration concerns, rollout risks, and reversibility.
   - Keep follow-up work out of the core plan unless it is required for correctness.
   - If the plan is high risk or contentious, recommend running `$review-plan` on it before implementation.

## Acolyte Checks

Apply these repo-specific checks while planning:

- All tools must still flow through `runTool`.
- New payloads, config, and model-facing contracts must be validated with Zod.
- Model output handling must preserve the `@signal` contract.
- TUI state updates that read current state must use functional updaters.
- Chat-layer changes must avoid direct `useEffect`; use the approved effect helpers.
- New boundaries should define the interface first.
- Shared string unions should start as Zod schemas and infer TypeScript types from them.

## Output Format

Return a concise plan with these sections:

- `Outcome`
- `Current-state evidence`
- `Proposed design`
- `Change list`
- `Validation`
- `Risks and open questions`

If the work is large, split `Change list` into phases. Each phase should still be independently valuable.

Reference concrete files and modules. Keep the plan actionable enough that implementation can start immediately.

## Anti-Patterns

- Planning from intuition without reading the current code
- Suggesting a broad refactor when a smaller canonical change exists
- Leaving validation vague
- Hiding uncertainty instead of stating assumptions
- Producing a task list without explaining why the chosen boundary is correct

## Boundaries

Do not implement the feature inside this skill flow unless the user explicitly switches from planning to execution.
