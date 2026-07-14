# Errors

Acolyte uses shared error contracts and coded runtime errors so tools, lifecycle code, transports, and the model can handle failures consistently.

## Contract model

Error codes and kinds are generic contracts shared across tools, lifecycle, and transport-facing parsing. The model reads error messages and decides what to do.

## Runtime model

Runtime code throws coded errors, not untyped string failures, when the failure should carry structured meaning. `ToolError` extends `CodedError` with a code and optional kind. Generic app/runtime failures may still be normalized into coded errors when they need stable handling downstream.

## Lifecycle boundary

Lifecycle consumes tool errors generically through error categories. Step budget exhaustion uses `E_BUDGET_EXHAUSTED` code.

## Design rule

Keep error contracts minimal. Error messages should be descriptive enough for the model to act on. Keep runtime error classes separate from parsing/normalization logic.

## Key files

- `src/error-contract.ts` — shared error codes and error kinds
- `src/coded-error.ts` — generic runtime base for coded errors
- `src/tool-error.ts` — tool-specific runtime error
- `src/error-handling.ts` — generic parsing and normalization of runtime errors
