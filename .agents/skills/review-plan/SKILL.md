---
name: review-plan
description: Adversarial review of a plan before implementation. Probes assumptions, missing cases, security gaps, reversibility, and complexity.
---

# Review Plan

Challenge a plan before committing to implementation. Use this skill when a coding agent (Acolyte, Claude, Codex, or any other) has produced a plan and you want a second opinion before executing it.

## Scope

Review the plan in context of the codebase. Do not review code — review the proposed approach.

## References

Read first:

- `AGENTS.md`
- `docs/architecture.md`

Then read the plan and any files it references.

## Workflow

1. Read the plan. Identify:
   - what it proposes to change
   - which files and boundaries it touches
   - what it assumes about the current state
2. Read the referenced files to verify the plan's assumptions are correct.
3. Challenge the plan across five dimensions:
   - **Assumptions** — what does the plan take for granted? Are those assumptions true in the current codebase?
   - **Missing cases** — what happens with empty input, concurrent access, error paths, edge cases the plan doesn't mention?
   - **Security** — does the plan introduce or widen an attack surface? Does it handle untrusted input?
   - **Reversibility** — can this be undone without a rewrite? Does it create migration debt?
   - **Complexity** — is this the simplest approach? Is it solving a real problem or a hypothetical one?
4. For each challenge, attempt to refute it. If the challenge doesn't hold up, discard it transparently.
5. Check scope:
   - does the plan touch more than it needs to?
   - does it miss files that should change together?
   - does it conflict with existing patterns in the codebase?
6. Report findings.

## Evidence threshold

Only report a finding when you can point to specific code, documented conventions, or concrete failure scenarios that support it.

Do not raise hypothetical concerns without a plausible scenario.

Prefer a short, high-signal review over an exhaustive but weak one.

## Output format

Findings first, ordered by severity. No preamble.

For each finding include:

- **severity** — blocker, concern, or nitpick
- **dimension** — which of the five dimensions it falls under
- **finding** — what's wrong or missing
- **evidence** — code reference or concrete scenario
- **suggestion** — smallest change to the plan that addresses it

Then include:

- **Refuted challenges** — challenges considered but discarded, with reasoning
- **Verdict** — proceed, revise, or rethink

## Rules

- Read the files the plan references before judging it.
- Verify assumptions against the actual codebase, not general knowledge.
- Prefer minimal plan adjustments over suggesting a completely different approach.
- Distinguish real blockers from preferences.
- Be direct. If the plan is solid, say so.

## Anti-patterns

- Challenging a plan without reading the referenced code
- Raising hypothetical concerns without concrete scenarios
- Suggesting a full redesign when a small adjustment would suffice
- Repeating the plan back instead of challenging it
- Rubber-stamping without actually checking assumptions
