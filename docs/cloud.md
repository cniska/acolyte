# Cloud

Cloud gives Acolyte portable agent identity — the same memory and sessions across machines.

## Goal

Local-first by default, cloud when opted in. A single feature flag switches storage from local SQLite to a hosted API without changing how memory or sessions behave. Self-hosting is a first-class path.

## Architecture

```
CLI → Cloud API (Vercel Edge) → Neon Postgres (pgvector)
```

The CLI ships a `CloudClient` that implements `MemoryStore` and `SessionStore` over HTTP. When `cloudSync` is enabled, all memory and session operations route through the cloud API instead of local SQLite/JSON storage.

The cloud API is a separate repo ([acolyte-cloud](https://github.com/cniska/acolyte-cloud)) deployed on Vercel Edge Functions, fronting Neon Postgres with pgvector for embedding storage and similarity search.

## Configuration

```bash
acolyte config set features.cloudSync true  # enable cloud sync (preview)
acolyte login                               # store token and cloud URL
```

Credentials are stored in `~/.acolyte/credentials` (mode 0600). Environment variables `ACOLYTE_CLOUD_URL` and `ACOLYTE_CLOUD_TOKEN` take precedence over the credentials file.

## Authentication

EdDSA JWT tokens (Ed25519) with scope claims:

- `sub` — user ID
- `tid` — team ID (optional, for team-scoped access)
- `oid` — org ID (optional, for org-scoped access)
- `scope` — active scope (`user`, `team`, or `org`)

All data is isolated by `owner_id` derived from the active scope:

| Scope | Owner ID source |
|-------|----------------|
| `user` (default) | `sub` |
| `team` | `tid` |
| `org` | `oid` |

## API

The cloud API is versioned at `/api/v1/`. All endpoints require `Authorization: Bearer <token>`.

| Domain | Method | Route | Description |
|--------|--------|-------|-------------|
| Memory | GET | `/api/v1/memories` | List memories |
| | POST | `/api/v1/memories` | Write memory |
| | DELETE | `/api/v1/memories/:id` | Delete memory |
| | POST | `/api/v1/memories/touch-recalled` | Update recall timestamps |
| Embeddings | POST | `/api/v1/memories/embeddings` | Write embedding |
| | POST | `/api/v1/memories/embeddings/get` | Batch get embeddings |
| | DELETE | `/api/v1/memories/embeddings/:id` | Delete embedding |
| | POST | `/api/v1/memories/embeddings/search` | Vector similarity search |
| Sessions | GET | `/api/v1/sessions` | List sessions |
| | POST | `/api/v1/sessions` | Save session |
| | GET | `/api/v1/sessions/:id` | Get session |
| | DELETE | `/api/v1/sessions/:id` | Delete session |
| | GET | `/api/v1/sessions/active` | Get active session |
| | PUT | `/api/v1/sessions/active` | Set active session |

## Multi-tenant isolation

Every table is keyed by `(owner_id, id)`. The auth middleware derives `owner_id` from JWT scope claims before any query runs. There is no cross-tenant data access path.

## Self-hosting

See [acolyte-cloud](https://github.com/cniska/acolyte-cloud) for setup and deployment instructions.

## Key files

- `src/cloud-client.ts` — cloud client with `MemoryStore` and `SessionStore` implementations
- `src/credentials.ts` — credentials file read/write (`~/.acolyte/credentials`)
- `src/app-config.ts` — `cloudUrl`, `cloudToken` (from env or credentials), and `cloudSync` feature flag
