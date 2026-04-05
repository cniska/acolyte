# Skills

Engineering skills for Acolyte development. Each skill is a step-by-step workflow, not reference documentation. Skills are loaded on-demand when the task matches.

```
plan → build → review → ship
```

## Skills

| Phase | Skill | Description |
|-------|-------|------------|
| **Plan** | [explore](skills/explore.md) | Clarify requirements through systematic questions |
| | [plan](skills/plan.md) | Design through dialogue, slice vertically |
| | [issue](../.agents/skills/issue/SKILL.md) | Check duplicates, draft, get approval, create |
| **Build** | [build](skills/build.md) | Vertical slices — implement, verify, commit, repeat |
| | [tdd](skills/tdd.md) | Red-green-refactor, mock at boundaries |
| | [debug](skills/debug.md) | Stop the line, reproduce, fix root cause, guard with test |
| | [design](skills/design.md) | Hard-to-misuse interfaces, contract first, validate at boundaries |
| | [simplify](skills/simplify.md) | Reduce complexity, Chesterton's Fence, preserve behavior |
| | [git](skills/git.md) | Atomic commits, clean history, rewrite before pushing |
| | [deprecation](skills/deprecation.md) | Build replacement first, migrate consumers, remove completely |
| **Review** | [review](skills/review.md) | Run all review dimensions, severity labels, fix-all policy |
| | [style](skills/style.md) | Local conventions, naming, control flow, readability |
| | [architecture](skills/architecture.md) | Boundaries, indirection pressure, contract integrity |
| | [tests](skills/tests.md) | Coverage gaps, edge cases, test quality |
| | [security](skills/security.md) | Trust boundaries, execution safety, concrete attack paths only |
| | [docs](skills/docs.md) | Drift detection, terminology, outdated names |
| **Ship** | [ship](../.agents/skills/ship/SKILL.md) | Pre-deploy checks, version bump, release |
| | [benchmark](../.agents/skills/benchmark/SKILL.md) | Run benchmarks and update metrics |
| **GitHub** | [pr](../.agents/skills/pr/SKILL.md) | Verify, review, then open the pull request |

## Principles

These show up across multiple skills and form the shared engineering philosophy.

| Principle | In practice | Skills |
|-----------|------------|--------|
| Vertical slices | One complete path through the stack at a time | build, plan |
| Contract first | Schema before implementation | design, build |
| SRP | One responsibility per module, one change per commit | architecture, build, git |
| YAGNI | Don't build for hypothetical requirements | architecture, design |
| Stop the line | Something breaks — stop, don't push past it | debug |
| Prove-It pattern | Failing test before fix | debug, tdd |
| Mock at boundaries | Mock external systems, not internal functions | tdd, tests |
| DAMP over DRY | Descriptive tests over deduplicated tests | tdd |
| Rule of 3 | Extract after three instances, not before | simplify, style |
| Chesterton's Fence | Understand before removing | simplify |
| Hyrum's Law | All observable behavior becomes a commitment | design, deprecation |
| Code as liability | Less code serving the same purpose is better | deprecation |
| Save-point pattern | Commit early when exploring uncertain changes | git |
| Evidence threshold | Concrete references, not speculation | review skills |
