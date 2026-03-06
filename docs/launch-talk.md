# Launch Talk

15-minute launch demo plan for Acolyte.

## Goal

Show that Acolyte can execute a scoped plan in a real repository with reproducible evidence.

## Demo format

- Primary: live execution from an almost-empty repository (`PROJECT_PLAN.md` plus minimal scaffold).
- Backup: pre-generated experiment repository with full evidence trail.

## Core concepts to explain

- Steer-only operation: operator provides plan and slice prompts, agent executes.
- Slice-by-slice delivery: small bounded steps with explicit verify gate.
- Evidence-first workflow: prompts, diffs, and verify results captured per slice.
- Reproducibility: another developer can replay the same protocol.

## 15-minute runbook

1. Frame the problem and protocol (2 min).
2. Show empty-start repository and plan file (1 min).
3. Run one live slice end-to-end (`prompt -> diff -> verify`) (6 min).
4. Open pre-generated experiment and show full evidence structure (4 min).
5. Show final artifact and close with key takeaway (2 min).

## Live execution checklist

- Keep prompts concrete and single-slice.
- Review each diff before proceeding.
- Run verification after each slice.
- Record prompt text and verification output.

## Backup flow checklist

- Open `METHOD` and `REPRODUCE` docs.
- Show prompt log and mapped commits.
- Show verify outputs for completed slices.
- Show final product/result state.

## Key takeaway

Acolyte is not a one-shot generator. It is an execution loop that can be steered with clear plans and validated with reproducible evidence.
