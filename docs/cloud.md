# Cloud

Acolyte Cloud is an opt-in storage backend that carries memory and sessions across machines through an authenticated, self-hostable API.

## Goal

Local-first by default, cloud when opted in. A single feature flag switches storage from local SQLite to a hosted API without changing how memory or sessions behave. Self-hosting is a first-class path.

## Architecture

```text
CLI → Cloud API (Vercel Edge) → Neon Postgres (pgvector)
```

The CLI ships a `CloudClient` that implements `MemoryStore` and `SessionStore` over HTTP. When `cloudSync` is enabled, all memory and session operations route through the cloud API instead of local SQLite/JSON storage.

The cloud API is a separate application, `app.acolyte.sh`, deployed on Vercel, fronting Neon Postgres with pgvector for embedding storage and similarity search.

## Configuration

```bash
acolyte config set features.cloudSync true  # enable cloud sync (preview)
acolyte login                               # store token and cloud URL
```

Credentials are stored in the config directory as `credentials` (mode 0600). See [Paths](paths.md) for platform-specific locations. Environment variables `ACOLYTE_CLOUD_URL` and `ACOLYTE_CLOUD_TOKEN` take precedence over the credentials file.

## Migration

`acolyte login` copies the machine's existing data into the account: project- and user-scoped memories with their embeddings, and every stored session. Session-scoped memories, the retired-memory archive, and the active-session pointer stay local.

Cloud writes upsert on the record id, so signing in again copies only what a previous run left behind. A rejected token ends the copy and exits non-zero; any other failure keeps the credentials and reports the count it could not move.

Migration runs one direction. Disabling `cloudSync` returns the CLI to the local database without the records written while cloud storage was active.

## Authentication

EdDSA JWT tokens (Ed25519) with a `sub` claim identifying the user. All data is isolated by `owner_id` derived from the token subject.

## API

The cloud API is versioned at `/api/v1/`. All endpoints require `Authorization: Bearer <token>`.

| Domain | Method | Route | Description |
|--------|--------|-------|-------------|
| Memory | GET | `/api/v1/memories` | List memories |
| | POST | `/api/v1/memories` | Write memory |
| | DELETE | `/api/v1/memories/:id` | Delete memory |
| | POST | `/api/v1/memories/touch-recalled` | Update recall timestamps |
| | POST | `/api/v1/memories/retire` | Retire memories into the archive |
| | GET | `/api/v1/memories/archive` | List archived memories |
| | POST | `/api/v1/memories/restore` | Restore archived memories |
| Embeddings | POST | `/api/v1/memories/embeddings` | Write embedding |
| | POST | `/api/v1/memories/embeddings/get` | Batch get embeddings |
| | DELETE | `/api/v1/memories/embeddings/:id` | Delete embedding |
| | POST | `/api/v1/memories/embeddings/search` | Vector similarity search |
| Sessions | GET | `/api/v1/sessions` | List sessions |
| | POST | `/api/v1/sessions` | Save session |
| | GET | `/api/v1/sessions/:id` | Get session |
| | PATCH | `/api/v1/sessions/:id/append` | Append new messages to a session |
| | POST | `/api/v1/sessions/:id/search` | Search a session's messages |
| | DELETE | `/api/v1/sessions/:id` | Delete session |
| | GET | `/api/v1/sessions/active` | Get active session |
| | PUT | `/api/v1/sessions/active` | Set active session |

## Data isolation

Every table is keyed by `(owner_id, id)`. The auth middleware derives `owner_id` from the JWT subject before any query runs. There is no cross-user data access path.

## Self-hosting

See [acolyte-cloud](https://github.com/cniska/acolyte-cloud) for setup and deployment instructions.

## Key files

- `src/cloud-client.ts` — cloud client with `MemoryStore` and `SessionStore` implementations
- `src/cloud-migrate.ts` — one-time copy of local memory and sessions into an account
- `src/cloud-migrate-runner.ts` — opens the local stores the copy reads from
- `src/credentials.ts` — credentials file read/write
- `src/app-config.ts` — `cloudUrl`, `cloudToken` (from env or credentials), and `cloudSync` feature flag

## Further reading

- [Memory](./memory.md) — what the records the cloud stores hold
- [Sessions](./sessions.md) — session storage and the active-session pointer
- [Configuration](./configuration.md) — feature flags and credentials
- [Paths](./paths.md) — where the credentials file lives
