# Protocol

## Goal

Define the stable request/response contract between client and server so transport can evolve (HTTP today, RPC later) without changing lifecycle behavior.

## Contract shape

- Request: one task payload (`message`, `history`, `sessionId`, runtime options).
- Stream: ordered event sequence for progress and tool activity.
- Final reply: single terminal payload with assistant output and usage metadata.

## Event model

Events are append-only and ordered per request.

- `status`: lifecycle/status updates for UI progress
- `reasoning`: optional model reasoning text
- `tool-call`: tool invocation start (id, name, args)
- `tool-output`: incremental tool output for the call id
- `tool-result`: tool completion (success/error, structured error detail)
- `text-delta`: assistant text stream chunks
- `error`: terminal stream error
- `done`: terminal success with final reply

## Invariants

- Every request has exactly one terminal event: `done` or `error`.
- `tool-output`/`tool-result` reference a prior `tool-call` id.
- Unknown event fields are ignored by clients (forward compatibility).
- Error detail payloads are structured and stable for recovery decisions.

## Versioning

- The protocol is versioned and negotiated by capability handshake.
- Additive changes are preferred; breaking changes require version bump.

## Transport stance

- Transport is an implementation detail.
- HTTP+SSE is the baseline.
- Future RPC transports must preserve this contract and ordering guarantees.

## RPC baseline (WebSocket)

RPC uses JSON envelopes with `id`, `type`, and optional `payload`.

Client methods:

- `status.get`
- `permissions.set` (`read` | `write`)
- `chat.start` (request payload)
- `chat.abort` (request id)
- `task.status` (task id)

Server responses:

- `status.result`
- `permissions.result`
- `chat.accepted`
- `chat.queued`
- `chat.started`
- `chat.event`
- `chat.done`
- `chat.error`
- `chat.abort.result`
- `task.status.result`
- `error`

Queue semantics:

- Only one chat request runs per connection at a time.
- Additional `chat.start` requests are accepted and reported as `chat.queued` with a 1-based position.
- Queue positions are re-emitted on queue changes (abort/dequeue) so clients can keep ordering accurate.
