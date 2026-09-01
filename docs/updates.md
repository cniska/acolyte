# Updates

Acolyte manages automatic binary updates, protocol compatibility, database migrations, semantic versioning, feature flags, and releases.

## Auto-update

The `acolyte` command on your PATH is a launcher. It runs whichever is newer: the binary the install owns, or a staged build under `<data>/bin/<version>/acolyte` (see [Paths](./paths.md)).

Starting the chat checks for a newer release, at most once per 24 hours. It downloads the binary, verifies the checksum, and stages it silently; the staged build runs the next time you start Acolyte. Only `x.y.z` versions are staged. An update writes inside the data directory alone, never to a file an installer or package manager owns.

Each start also removes staged builds the running one has caught up with, so the directory holds at most the build waiting to run.

Skip the check with `--no-update` or `ACOLYTE_SKIP_UPDATE=1`. Force a check with `acolyte update`, which reports progress and the version it staged. `acolyte status` names a staged version while one is waiting.

Delete `<data>/bin` to return to the binary the install owns. A staged build that fails at startup cannot stage its own replacement, so this is the way back to a version that runs.

## Version compatibility

- **Protocol** — the client-server protocol is versioned. Server and client validate the protocol version on connection and reject mismatches cleanly.
- **Build** — the daemon reports the version and commit it was started from. A client serves requests only through a daemon of its own build: when a staged update starts, it asks the daemon the previous build left running to shut down and starts its own. A daemon that refuses because a turn is live keeps serving until that turn ends. `acolyte status` names the running build.
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
