---
name: arch-audit
description: Audit architecture and design consistency in Acolyte, flag drift from established patterns, and propose minimal contract-first fixes.
---

# Arch Audit

Use this skill when asked to review architecture quality, design consistency, extension seams, or pattern adherence.

## Scope

Focus on:
- lifecycle phase boundaries and evaluator-driven behavior
- tool architecture (toolkits, registry, guarded execution)
- contracts/schemas as source of truth (Zod + inferred types)
- transport and protocol consistency (HTTP/RPC parity)
- reliability contracts (timeouts, retries, cancellation semantics, queue/backpressure behavior)
- observability contracts (stable codes/events, actionable errors, traceability across layers)
- guard/evaluator extensibility without test-only production hacks
- error contracts and user-facing message consistency
- assert patterns and exhaustiveness (`invariant`, `unreachable`, `switch` with `default`)
- design-pattern consistency for extension seams (policy/strategy tables, adapter boundaries)
- ERC/error-model consistency (`AppError`/coded errors, stable searchable codes, clear UX messages)

## Canonical References

Read these first:
- `docs/architecture.md`
- `AGENTS.md`
- `docs/roadmap.md` (premvp vs postmvp intent)

Then inspect relevant code:
- `src/lifecycle*.ts`
- `src/tool-guards.ts`
- `src/*tools*.ts`
- `src/*protocol*.ts`, `src/server.ts`, `src/client.ts`
- `src/config*.ts`

## Audit Workflow

1. Build the expected architecture map from docs/contracts.
2. Compare implementation against that map.
3. Report findings ordered by severity:
- correctness/regression risk
- contract drift / protocol mismatch
- extension-blocking design smells
- maintainability issues
4. For each finding include:
- impacted files
- why it violates intended pattern
- minimal fix direction
5. Only propose abstractions that pass YAGNI and Rule of Three.

## Output Format

- Findings first (no long preamble)
- Include concrete file references
- Separate:
  - confirmed issues
  - open questions/assumptions
  - optional follow-up refactors

## Guardrails

- Do not suggest speculative frameworks/plugin systems.
- Prefer small contract-preserving changes over broad rewrites.
- Keep docs conceptual; avoid implementation-detail docs that drift.
