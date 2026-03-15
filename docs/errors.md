# Errors

Error handling in Acolyte is split by boundary, not bundled into one module.

## Layers

- `src/error-contract.ts` — shared error codes and error kinds
- `src/coded-error.ts` — generic runtime base for coded errors
- `src/tool-error.ts` — tool-specific runtime error with optional `ToolRecovery`
- `src/tool-recovery.ts` — tool-owned recovery contract and parser
- `src/error-handling.ts` — generic parsing and normalization of runtime errors

## Contract model

- Error codes and kinds are generic contracts shared across tools, lifecycle, and transport-facing parsing.
- `ToolRecovery` is a separate contract for stable, tool-owned recovery guidance.
- Recovery is optional and only used when a tool can state a concrete next step without host-side guessing.

## Runtime model

- Runtime code throws coded errors, not untyped string failures, when the failure should carry structured meaning.
- `ToolError` extends `CodedError` and may include `ToolRecovery`.
- Generic app/runtime failures may still be normalized into coded errors when they need stable handling downstream.

## Lifecycle boundary

- Lifecycle consumes tool recovery generically.
- Lifecycle does not hardcode tool-specific retry policy in evaluators.
- Tool-specific recovery semantics stay with the tool and its recovery contract.

## Design rule

- Keep generic error contracts separate from tool-specific recovery contracts.
- Keep runtime error classes separate from parsing/normalization logic.
- When behavior belongs in a tool failure contract, move it there instead of adding lifecycle heuristics.
