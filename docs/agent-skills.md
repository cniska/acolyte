# Skills

Engineering skills for Acolyte development. Each skill is a step-by-step workflow, not reference documentation. Skills are loaded on-demand when the task matches.

## By phase

### Plan
| Skill | Use when |
|-------|----------|
| [explore](../.agents/skills/explore/SKILL.md) | Clarifying requirements through systematic questions |
| [plan](../.agents/skills/plan/SKILL.md) | Designing a feature or behavior change through dialogue |

### Build
| Skill | Use when |
|-------|----------|
| [build](../.agents/skills/build/SKILL.md) | Implementing features incrementally through vertical slices |
| [tdd](../.agents/skills/tdd/SKILL.md) | Driving implementation with red-green-refactor |
| [debug](../.agents/skills/debug/SKILL.md) | Diagnosing failures with structured triage |
| [design](../.agents/skills/design/SKILL.md) | Defining tool contracts, RPC payloads, or module boundaries |
| [simplify](../.agents/skills/simplify/SKILL.md) | Reducing complexity while preserving behavior |
| [git](../.agents/skills/git/SKILL.md) | Managing commits, branches, and change history |
| [deprecation](../.agents/skills/deprecation/SKILL.md) | Removing or replacing outdated code safely |

### Review
| Skill | Use when |
|-------|----------|
| [review](../.agents/skills/review/SKILL.md) | Running all review dimensions before merge |
| [style](../.agents/skills/style/SKILL.md) | Checking code style, naming, and pattern consistency |
| [architecture](../.agents/skills/architecture/SKILL.md) | Checking architecture, boundaries, and design consistency |
| [tests](../.agents/skills/tests/SKILL.md) | Checking test coverage, quality, and edge cases |
| [security](../.agents/skills/security/SKILL.md) | Checking security risks, trust boundaries, and unsafe defaults |
| [docs](../.agents/skills/docs/SKILL.md) | Checking documentation drift and missing updates |

### Ship
| Skill | Use when |
|-------|----------|
| [ship](../.agents/skills/ship/SKILL.md) | Cutting a release with pre-deploy checks |
| [benchmark](../.agents/skills/benchmark/SKILL.md) | Running benchmarks and updating metrics |
| [pr](../.agents/skills/pr/SKILL.md) | Creating a pull request with review and verify |
| [issue](../.agents/skills/issue/SKILL.md) | Filing a GitHub issue from a short description |

## Principles

These show up across multiple skills and form the shared engineering philosophy.

| Principle | In practice | Skills |
|-----------|------------|--------|
| Vertical slices | Build one complete path through the stack at a time | build, plan |
| Contract first | Define the interface before implementing it; the schema is the source of truth | design, build |
| SRP | One responsibility per module, one logical change per commit | architecture, build, git |
| YAGNI | Don't build for hypothetical future requirements | architecture, design |
| Stop the line | When something breaks, stop building; errors compound | debug |
| Prove-It pattern | For bugs, write a failing test first to prove the bug exists | debug, tdd |
| Mock at boundaries | Mock external systems (database, network, APIs), not internal functions | tdd, tests |
| DAMP over DRY | In tests, prefer descriptive and meaningful phrases over eliminating duplication | tdd |
| Rule of 3 | Don't extract a shared function until you have three instances | simplify, style |
| Chesterton's Fence | Before removing code you don't understand, first understand why it exists | simplify |
| Hyrum's Law | All observable behaviors become dependencies; be deliberate about what you expose | design, deprecation |
| Code as liability | Value comes from functionality, not code volume; less code is better | deprecation |
| Save-point pattern | Commit early when exploring; uncommitted work can't be reverted | git |
| Evidence threshold | Findings need concrete code references, not speculation | review skills |
