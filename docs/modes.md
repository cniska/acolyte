# Modes

Acolyte uses explicit operating modes to shape behavior:

- `plan`
- `work`
- `verify`

## Purpose

- **plan**: produce a concrete execution plan.
- **work**: execute task changes directly.
- **verify**: validate behavior and report findings.

## Selection

- Mode classification starts from request intent.
- Lifecycle policy and evaluator behavior are mode-aware.
- Model overrides can be configured per mode through `models.<mode>`.

## Why modes exist

- Keep intent and behavior aligned.
- Avoid planning in execution flows.
- Preserve verification as a first-class, explicit phase.

## Key files

- `src/agent-modes.ts`
- `src/lifecycle-classify.ts`
- `src/lifecycle-evaluators.ts`
