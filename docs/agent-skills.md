# Skills

Engineering skills for Acolyte development. Each skill is a step-by-step workflow, not reference documentation. Skills are loaded on-demand when the task matches.

```
plan → build → review → ship
```

## Skills

| Phase | Skill | Description |
|-------|-------|------------|
| **Plan** | [explore](../.agents/skills/explore/SKILL.md) | Clarify requirements through systematic questions |
| | [plan](../.agents/skills/plan/SKILL.md) | Design through dialogue, slice vertically |
| | [issue](../.agents/skills/issue/SKILL.md) | Check duplicates, draft, get approval, create |
| **Build** | [build](../.agents/skills/build/SKILL.md) | Vertical slices — implement, verify, commit, repeat |
| | [tdd](../.agents/skills/tdd/SKILL.md) | Red-green-refactor, mock at boundaries |
| | [debug](../.agents/skills/debug/SKILL.md) | Stop the line, reproduce, fix root cause, guard with test |
| | [design](../.agents/skills/design/SKILL.md) | Hard-to-misuse interfaces, contract first, validate at boundaries |
| | [simplify](../.agents/skills/simplify/SKILL.md) | Reduce complexity, Chesterton's Fence, preserve behavior |
| | [git](../.agents/skills/git/SKILL.md) | Atomic commits, clean history, rewrite before pushing |
| | [deprecation](../.agents/skills/deprecation/SKILL.md) | Build replacement first, migrate consumers, remove completely |
| **Review** | [review](../.agents/skills/review/SKILL.md) | Run all review dimensions, severity labels, fix-all policy |
| | [style](../.agents/skills/style/SKILL.md) | Local conventions, naming, control flow, readability |
| | [architecture](../.agents/skills/architecture/SKILL.md) | Boundaries, indirection pressure, contract integrity |
| | [tests](../.agents/skills/tests/SKILL.md) | Coverage gaps, edge cases, test quality |
| | [security](../.agents/skills/security/SKILL.md) | Trust boundaries, execution safety, concrete attack paths only |
| | [docs](../.agents/skills/docs/SKILL.md) | Drift detection, terminology, outdated names |
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
