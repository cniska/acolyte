# Cloud

Cloud gives Acolyte portable agent identity — the same memory and sessions across machines.

## Architecture

```
CLI → Cloud API (Vercel Edge) → Neon Postgres (pgvector)
```

The CLI ships cloud store clients that talk to the cloud API over HTTP. The cloud API is a separate repo deployed on Vercel Edge Functions, fronting Neon Postgres with pgvector for embedding storage and similarity search.

## Configuration

```toml
cloudUrl = "https://cloud.acolyte.sh"

[features]
cloudSync = true
```

The token is set via the `ACOLYTE_CLOUD_TOKEN` environment variable — it is never persisted to config files.

When `cloudSync` is enabled with a valid `cloudUrl` and `cloudToken`, all memory and session operations route through the cloud API instead of local SQLite/JSON storage.

## Authentication

Cloud uses EdDSA JWT tokens (Ed25519) with scope claims:

- `sub` — user ID
- `tid` — team ID (optional, for team-scoped access)
- `oid` — org ID (optional, for org-scoped access)
- `scope` — active scope (`user`, `team`, or `org`)

All data is isolated by `owner_id` derived from the active scope.

## Self-hosting

Deploy the cloud API to your own Vercel + Neon Postgres:

1. Clone the cloud API repo
2. Configure `DATABASE_URL` and `JWT_SECRET` in Vercel env vars
3. Deploy with `vercel deploy`
4. Point your CLI at the deployment URL

## API versioning

The cloud API is versioned at `/api/v1/`. Routes are defined in `src/cloud-client.ts`.

## Key files

- `src/cloud-client.ts` — cloud client with `MemoryStore` and `SessionStore` implementations
