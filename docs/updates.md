# Updates

How Acolyte handles versioning, updates, and breaking changes.

## Auto-update

The CLI checks for updates on startup (at most once per 24 hours). When a newer version exists, it downloads the binary, verifies the checksum, replaces itself, stops the running server, and re-execs. The user sees a progress bar and then the new version starts normally.

Skip the check with `--skip-update` or `ACOLYTE_SKIP_UPDATE=1`. Force a check with `acolyte update`.

## Version compatibility

- **Protocol** — the client-server protocol is versioned. Server and client validate the protocol version on connection and reject mismatches cleanly.
- **Database schemas** — SQLite stores (memory, trace, cache) will use forward migrations when schemas change. No migration framework exists yet — it will be added when the first schema change requires one.
- **Configuration** — same approach. Config migrations will be added when a release changes the config format.

## Versioning

Releases follow [semver](https://semver.org). Patch and minor releases are always safe to apply. Major releases may include breaking changes to the protocol, configuration, or database schemas.

## Release process

The `scripts/release.sh` script bumps the version, generates a changelog entry, commits, and tags. CI builds platform binaries and publishes a GitHub release. The install script and auto-updater pull from GitHub releases.
