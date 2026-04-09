# Protocol

Transport-facing contract and invariants between Acolyte client and server.

## Goal

Define the stable request/response contract between client and server so transport can evolve without changing lifecycle behavior.

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
- `usage`: token usage for the current generation step
- `checklist`: inline task checklist with group ID, title, and items
- `error`: terminal stream error

## Invariants

- Every request completes with either a `chat.done` or `chat.error` RPC message.
- `tool-output`/`tool-result` reference a prior `tool-call` id.
- Unknown event fields are ignored by clients (forward compatibility).
- Error detail payloads are structured and stable.

## Versioning

- The protocol is versioned and negotiated by capability handshake.
- Additive changes are preferred; breaking changes require version bump.

## Transport stance

- Transport is an implementation detail.
- HTTP+SSE and WebSocket RPC are both supported.
- New transports must preserve this contract and ordering guarantees.

## RPC baseline (WebSocket)

RPC uses JSON envelopes with transport request `id` (`rpc_*`), `type`, and optional `payload`.
Domain task ids are separate (`task_*`).

Authentication:
- HTTP endpoints use `Authorization: Bearer <apiKey>`.
- WebSocket RPC uses Bearer auth via `sec-websocket-protocol` (`bearer.<apiKey>`).

Client methods:

- `status.get`
- `chat.start` (request payload)
- `chat.abort` (request id)
- `task.status` (task id)

Server responses:

- `status.result`
- `chat.accepted` (includes `taskId`)
- `chat.queued`
- `chat.started`
- `chat.event`
- `chat.done`
- `chat.error` (may include `errorId`)
- `chat.abort.result`
- `task.status.result`
- `error`

Queue semantics:

- Only one chat request runs per connection at a time.
- Additional `chat.start` requests are accepted and reported as `chat.queued` with a 1-based position.
- Queue positions are re-emitted on queue changes (abort/dequeue) so clients can keep ordering accurate.
- `chat.abort` targets request id, while task lifecycle/state uses task id.
