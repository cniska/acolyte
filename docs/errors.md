# Errors

Acolyte uses shared error contracts and coded runtime errors so tools, lifecycle code, transports, and the model can handle failures consistently.

## Contract model

Error codes and kinds are generic contracts shared across tools, lifecycle, and transport-facing parsing. The model reads error messages and decides what to do.

## Runtime model

Runtime code throws coded errors, not untyped string failures, when the failure should carry structured meaning. `ToolError` extends `CodedError` with a code and optional kind. Generic app/runtime failures may still be normalized into coded errors when they need stable handling downstream.

## Codes, kinds, and categories

A code identifies one failure, a kind classifies what sort of failure it is, and a category is the coarse bucket the turn's error stats count. Kind derives from the code, and every tool code declares one. A missing path is named at the tool boundary, where the filesystem's errno becomes `E_FILE_NOT_FOUND`.

## Lifecycle boundary

Lifecycle counts tool errors in the coarse categories and records the precise code and kind on each error event. Step budget exhaustion uses `E_BUDGET_EXHAUSTED` code.

## Transport boundary

A turn whose transport dies mid-flight fails with `E_DAEMON_LOST` and kind `daemon_lost`, carrying the task id when one was assigned. The message states that the session survived and the turn can be sent again; the turn itself is never rebuilt from partial output.

## Design rule

Keep error contracts minimal. Error messages should be descriptive enough for the model to act on. Keep runtime error classes separate from parsing/normalization logic.

## Key files

- `src/error-contract.ts` — shared error codes and error kinds
- `src/coded-error.ts` — generic runtime base for coded errors
- `src/tool-error.ts` — tool-specific runtime error
- `src/error-handling.ts` — generic parsing and normalization of runtime errors
