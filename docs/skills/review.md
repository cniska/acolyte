---
name: review
description: Run all review dimensions against a diff or a path. Use when reviewing a feature branch before merge, reviewing someone else's PR, or auditing a file path.
---

# Review

Run all review dimensions against the current branch and produce one unified review. Approve when a change improves overall code health, even if it isn't perfect.

Three modes: **Self** (no argument) — current branch diff against `main`; **PR** (URL or number) — someone else's PR; **Path** (file or directory) — full-file audit of code already on `main`.

## Scope

**Self / PR:** review only the diff, but read enough surrounding code and docs to understand conventions and boundaries. **Path:** review the enumerated files in full — there is no diff.

Do not duplicate the same issue across categories.

## Change sizing

Self and PR modes only — Path has no diff. Before reviewing, check the diff size:

- ~100 lines: good, reviewable in one pass.
- ~300 lines: acceptable if one logical change.
- ~1000 lines: too large — ask the author to split before reviewing.

Refactoring mixed with feature work is two changes. Flag it.

## Workflow

### Self (no argument)

1. Determine diff scope: `git log main..HEAD --oneline` and `git diff main...HEAD --stat`. If no commits ahead of `main`, report and stop.
2. Read changed files in full, plus any project-level convention docs. **Review tests first** — they reveal intent and coverage gaps.
3. Run the six dimension passes — load each skill (`correctness-review`, `style-review`, `architecture-review`, `doc-review`, `security-review`, `test-review`) and apply its criteria to the diff, one pass per dimension. If a skill fails to load, say so in that category's output rather than improvising.
4. Merge findings: deduplicate, keep strongest framing per root issue.
5. Label every finding by severity (see below). Fix all findings by default — each as its own subject-scoped commit.

### PR (URL or number)

1. `gh pr view <N>` for metadata; `gh pr diff <N>` for the diff. Read repo conventions — `AGENTS.md`.
2. Run the six dimension passes (as in Self step 3). Filter relentlessly — only findings with evidence.

### Path (file or directory)

1. Enumerate files; skip generated content, lockfiles, `node_modules/`.
2. Read conventions. Run the six dimension passes (as in Self step 3) over the full files.

## Severity

Label every finding explicitly — an unlabeled finding is ambiguous. This scale is canonical; dimension skills map their labels onto it.

| Label | Meaning |
|-------|---------|
| **Critical:** | Blocks merge — security, data loss, broken functionality |
| **Fix:** | A real defect or convention violation; address before merge |
| **Consider:** | Worth thinking about, not required |
| **Nit:** | Style preference, minor improvement |

Order output Critical → Fix → Consider → Nit. In the summary table, Consider and Nit both count as optional.

## Review checks

Look for these patterns in every review:

- term drift across code, schemas, tests, and docs after a rename or protocol change
- shared contracts that blur distinct intent where separate variants or schemas would be clearer
- escape hatches, bypass flags, and special-case options that are broader than the behavior they enable
- updated implementation that leaves stale references behind in tests or docs

## Dependency review

If the change adds a dependency, check:
- Does the existing stack already solve this?
- Is it actively maintained?
- What's the size impact?
- Any known vulnerabilities?

Every dependency is a liability.

## Fix policy

- **Self:** fix all findings by default — including trivial ones — each as its own subject-scoped commit. Small issues left unfixed accumulate into tech debt.
- **PR:** never commit to someone else's branch. Deliver findings as a review (`gh pr review`), or a comment block if asked.
- **Path:** report findings; fix only when the user asks.

## Output

One section per review dimension (Correctness, Style, Architecture, Documentation, Security, Tests), noting dimensions with no findings. Always end with this summary table — one row per dimension, counts of findings per severity (Consider and Nit both count as Optional):

| Category | Critical | Fix | Optional |
|----------|----------|-----|----------|
| Correctness | 0 | 0 | 0 |
| Style | 0 | 0 | 0 |
| Architecture | 0 | 0 | 0 |
| Documentation | 0 | 0 | 0 |
| Security | 0 | 0 | 0 |
| Tests | 0 | 0 | 0 |

## Red flags

- Reviewing only the diff without reading touched files in context
- Duplicating the same root issue across categories
- Generic cleanup wishlists
- Speculative issues without evidence
- Broad rewrite suggestions out of scope
- "LGTM" without evidence of review
- Softening real issues — if it's a bug, say so directly
- Accepting "I'll fix it later" — require cleanup before merge
