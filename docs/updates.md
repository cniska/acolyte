# Updates

How Acolyte handles versioning, updates, and breaking changes.

## Auto-update

The CLI checks for updates on startup (at most once per 24 hours). When a newer version exists, it downloads the binary, verifies the checksum, replaces itself, stops the running server, and re-execs. The user sees a progress bar and then the new version starts normally.

Skip the check with `--skip-update` or `ACOLYTE_SKIP_UPDATE=1`. Force a check with `acolyte update`.

## Version compatibility

Auto-update keeps version drift unlikely — most users are on the latest release within 24 hours. Despite this, Acolyte treats compatibility as a first-class concern:

- **Protocol** — the client-server protocol is versioned. Server and client validate the protocol version on connection and reject mismatches cleanly.
- **Database schemas** — SQLite stores (memory, trace, cache) use forward migrations when schemas change. Migrations run automatically on startup.
- **Configuration** — config changes include migrations that preserve user settings across versions.

The narrow version window means we only need to support N-1 → N migrations, not arbitrary version jumps. But the migrations are always there — even when the probability of hitting them is low.

## Release process

Releases follow semver. The `scripts/release.sh` script bumps the version, generates a changelog entry, commits, and tags. CI builds platform binaries and publishes a GitHub release. The install script and auto-updater pull from GitHub releases.
