# Updates

Acolyte manages automatic binary updates, protocol compatibility, database migrations, semantic versioning, feature flags, and releases.

## Auto-update

The `acolyte` command on your PATH is a launcher. It runs whichever is newer: the binary the install owns, or a staged build under `<data>/bin/<version>/acolyte` (see [Paths](./paths.md)).

The CLI checks for updates on startup (at most once per 24 hours). When a newer version exists, it downloads the binary, verifies the checksum, and stages it. Nothing is printed and the running session is untouched; the staged build starts the next time you run `acolyte`. Builds older than the one running are removed at startup, so the staging directory holds one build.

Staging writes only inside the data directory, so an update never overwrites a file an installer or package manager owns.

Skip the check with `--no-update` or `ACOLYTE_SKIP_UPDATE=1`. Force a check with `acolyte update`, which reports progress and the version it staged. `acolyte status` names a staged version while one is waiting.

## Version compatibility

- **Protocol** — the client-server protocol is versioned. Server and client validate the protocol version on connection and reject mismatches cleanly.
- **Database schemas** — SQLite stores (memory, trace) use versioned forward migrations (`db-migrate.ts`). Each store defines a migrations array; pending migrations run automatically on startup within transactions. Migrations are cumulative — if a user skips several versions, all intermediate migrations run in sequence.
- **Configuration** — same approach. Config migrations will be added when a release changes the config format.

## Versioning

Releases follow [semver](https://semver.org). Patch and minor releases are always safe to apply. Major releases may include breaking changes to the protocol, configuration, or database schemas.

## Feature flags and deprecations

Some features ship behind flags while they stabilize. When a flag is no longer needed, we remove it deliberately:

- If a flag is user-settable (config/env/CLI): first deprecate it by making it a no-op and emitting a warning. Then remove it after one or more releases. Removal is documented in the release notes for that version.
- if a flag is internal-only and not user-settable: it may be removed without a deprecation window.

## Release process

The [`scripts/release.sh`](../scripts/release.sh) script bumps the version, generates a changelog entry, commits, and tags. CI builds platform binaries and publishes a GitHub release. The install script and auto-updater pull from GitHub releases.
