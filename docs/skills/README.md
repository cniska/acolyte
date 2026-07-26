# Skills

```
plan → build → review
```

Acolyte's engineering discipline. Each skill encodes a workflow the agent can activate when the task calls for it. Bundled skills are project-agnostic and available in every workspace.

These are specialized for Acolyte from the tool-agnostic set at [cniska/skills](https://github.com/cniska/skills), which carries the same workflow for any agent.

Multiple skills can be active in one session. The agent can load one or more in a single call, and the active set is shown in the status line.

## Descriptions

The agent selects a skill from the roster — the per-turn line of names and `description`s — with nothing else to match on, so the `description` is the whole selection signal. Each follows one shape: `<imperative capability>. Use when <precise, observable trigger>.` The first sentence says what the skill does; the second gives a trigger phrased to fire exactly when the skill applies and stay quiet otherwise, naming the boundary against neighboring skills (build vs tdd, plan vs design, style-review vs the other review dimensions). Keep it under the roster's 250-character cap.

## Skills

| Phase | Skill | Description |
|-------|-------|------------|
| **Plan** | [Plan](plan.md) | Design through dialogue, slice vertically, clarify through questions |
| **Build** | [Build](build.md) | Vertical slices — implement, verify, commit, repeat |
| | [TDD](tdd.md) | Red-green-refactor, mock at boundaries |
| | [Debug](debug.md) | Stop the line, reproduce, fix root cause, guard with test |
| | [Design](design.md) | Hard-to-misuse interfaces, contract first, validate at boundaries |
| | [Simplify](simplify.md) | Reduce complexity, Chesterton's Fence, preserve behavior |
| | [Git](git.md) | Atomic commits, clean history, rewrite before pushing |
| | [Deprecation](deprecation.md) | Build replacement first, migrate consumers, remove completely |
| **Review** | [Review](review.md) | Run all review dimensions, severity labels, fix-all policy |
| | [Correctness Review](correctness-review.md) | Logic bugs, edge cases, broken contracts |
| | [Style Review](style-review.md) | Local conventions, naming, control flow, readability |
| | [Architecture Review](architecture-review.md) | Boundaries, indirection pressure, contract integrity |
| | [Test Review](test-review.md) | Coverage gaps, edge cases, test quality |
| | [Security Review](security-review.md) | Trust boundaries, execution safety, concrete attack paths only |
| | [Documentation Review](doc-review.md) | Drift detection, terminology, outdated names |
| **Meta** | [AGENTS.md](agents-md.md) | Create or update AGENTS.md project rules |

## Principles

These show up across multiple skills and form the shared engineering philosophy.

| Principle | In practice | Skills |
|-----------|------------|--------|
| Vertical slices | One complete path through the stack at a time | build, plan |
| Contract first | Schema before implementation | design, build |
| SRP | One responsibility per module, one change per commit | architecture-review, build, git |
| YAGNI | Don't build for hypothetical requirements | architecture-review, design |
| Stop the line | Something breaks — stop, don't push past it | debug |
| Prove-It pattern | Failing test before fix | debug, tdd |
| Mock at boundaries | Mock external systems, not internal functions | tdd, test-review |
| DAMP over DRY | Descriptive tests over deduplicated tests | tdd |
| Rule of 3 | Extract after three instances, not before | simplify, style-review |
| Chesterton's Fence | Understand before removing | simplify |
| Hyrum's Law | All observable behavior becomes a commitment | design, deprecation |
| Code as liability | Less code serving the same purpose is better | deprecation |
| Source over memory | Verify framework behavior in primary docs before implementation | build |
| Save-point pattern | Commit early when exploring uncertain changes | git |
| Evidence threshold | Concrete references, not speculation | review skills |
