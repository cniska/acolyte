# Protocol

Acolyte defines a versioned transport contract for requests, ordered event streams, task state, errors, authentication, and final responses.

## Goal

Define the stable request/response contract between client and server so transport can evolve without changing lifecycle behavior.

## Contract shape

- request: one task payload (`message`, `history`, `sessionId`, runtime options).
- stream: ordered event sequence for progress and tool activity.
- final reply: single terminal payload with assistant output and usage metadata.

## Event model

Events are append-only and ordered per request.

- `status` — lifecycle/status updates for UI progress
- `reasoning` — optional model reasoning text
- `tool-call` — tool invocation start (id, name, args)
- `tool-output` — incremental tool output for the call id; a `transient: true` part is a still-running preview that the next non-transient part for that call id replaces, rather than appends to
- `tool-result` — tool completion (success/error, structured error detail)
- `text-delta` — assistant text stream chunks
- `text-end` — end of a block of assistant text; the next block opens a new paragraph
- `usage` — token usage for the current generation step
- `tasklist` — inline task list with group ID, title, and items
- `error` — terminal stream error

## Invariants

- every request completes with either a `chat.done` or `chat.error` RPC message.
- `tool-output`/`tool-result` reference a prior `tool-call` id.
- unknown event fields are ignored by clients (forward compatibility).
- error detail payloads are structured and stable.

## Versioning

- the protocol is versioned and negotiated by capability handshake.
- additive changes are preferred; breaking changes require version bump.
- the status payload carries the daemon's `build` (version and commit); a client reuses a daemon only when that matches its own. See [Updates](./updates.md).

## Transport stance

- transport is an implementation detail.
- HTTP+SSE and WebSocket RPC are both supported.
- new transports must preserve this contract and ordering guarantees.

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

- only one chat request runs per connection at a time.
- additional `chat.start` requests are accepted and reported as `chat.queued` with a 1-based position.
- queue positions are re-emitted on queue changes (abort/dequeue) so clients can keep ordering accurate.
- `chat.abort` targets request id, while task lifecycle/state uses task id.
