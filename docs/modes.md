# Modes

Acolyte uses two explicit operating modes to shape behavior: `work` and `verify`.

## Purpose

- **work**: execute task changes directly
- **verify**: validate behavior and report findings

## Behavior

- **work** stays inside the requested scope, favors surgical edits, and preserves unrelated file content.
- **verify** chooses the lightest sufficient validation for the actual change instead of assuming every task needs full-project checks.

## Selection

- mode classification starts from request intent
- lifecycle policy and evaluator behavior are mode-aware
- model overrides can be configured per mode through `models.<mode>`

## Why modes exist

- keep intent and behavior aligned
- preserve verification as a first-class, explicit phase

## Key files

- `src/agent-modes.ts` — Mode configurations with tool grants and preambles.
- `src/lifecycle-resolve.ts` — Mode and model selection during task execution.
- `src/lifecycle-evaluators.ts` — Mode-aware post-generation evaluators.
