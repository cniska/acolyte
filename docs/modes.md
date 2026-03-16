# Modes

Acolyte uses two explicit operating modes to shape behavior: `work` and `verify`.

## Purpose

- **work**: execute task changes directly.
- **verify**: validate behavior and report findings.

## Behavior

- **work** stays inside the requested scope, favors surgical edits, and preserves unrelated file content.
- **verify** chooses the lightest sufficient validation for the actual change instead of assuming every task needs full-project checks.

## Selection

- Mode classification starts from request intent.
- Lifecycle policy and evaluator behavior are mode-aware.
- Model overrides can be configured per mode through `models.<mode>`.

## Why modes exist

- Keep intent and behavior aligned.
- Preserve verification as a first-class, explicit phase.

## Key files

- `src/agent-modes.ts`
- `src/lifecycle-resolve.ts`
- `src/lifecycle-evaluators.ts`
