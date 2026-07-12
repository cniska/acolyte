# Skills

```
plan → build → review
```

Acolyte's engineering discipline. Each skill encodes a workflow the agent can activate when the task calls for it. Bundled skills are project-agnostic and available in every workspace.

These are specialized for Acolyte from the tool-agnostic set at [cniska/skills](https://github.com/cniska/skills), which carries the same workflow for any agent.

## Skills

| Phase | Skill | Description |
|-------|-------|------------|
| **Plan** | [plan](plan.md) | Design through dialogue, slice vertically, clarify through questions |
| **Build** | [build](build.md) | Vertical slices — implement, verify, commit, repeat |
| | [tdd](tdd.md) | Red-green-refactor, mock at boundaries |
| | [debug](debug.md) | Stop the line, reproduce, fix root cause, guard with test |
| | [design](design.md) | Hard-to-misuse interfaces, contract first, validate at boundaries |
| | [simplify](simplify.md) | Reduce complexity, Chesterton's Fence, preserve behavior |
| | [git](git.md) | Atomic commits, clean history, rewrite before pushing |
| | [deprecation](deprecation.md) | Build replacement first, migrate consumers, remove completely |
| **Review** | [review](review.md) | Run all review dimensions, severity labels, fix-all policy |
| | [correctness-review](correctness-review.md) | Logic bugs, edge cases, broken contracts |
| | [style-review](style-review.md) | Local conventions, naming, control flow, readability |
| | [architecture-review](architecture-review.md) | Boundaries, indirection pressure, contract integrity |
| | [test-review](test-review.md) | Coverage gaps, edge cases, test quality |
| | [security-review](security-review.md) | Trust boundaries, execution safety, concrete attack paths only |
| | [doc-review](doc-review.md) | Drift detection, terminology, outdated names |

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
| Save-point pattern | Commit early when exploring uncertain changes | git |
| Evidence threshold | Concrete references, not speculation | review skills |
