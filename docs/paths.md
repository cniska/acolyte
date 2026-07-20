# Paths

Acolyte uses one XDG-style global layout on macOS and Linux. Environment variables override the defaults. Relative paths in XDG variables are ignored per spec.

| Category | Default | Env override |
|---|---|---|
| Config | `~/.config/acolyte/` | `$XDG_CONFIG_HOME/acolyte/` |
| Data | `~/.local/share/acolyte/` | `$XDG_DATA_HOME/acolyte/` |
| State | `~/.local/state/acolyte/` | `$XDG_STATE_HOME/acolyte/` |
| Binary | `~/.local/bin/acolyte` | — |

## What goes where

- **Config** — user-edited settings and credentials: `config.toml`, `credentials`, `oauth.json`
- **Data** — persistent application data: `memory.db`, `sessions.json`, `trace.db`, `tool.db`, `projects/`
- **State** — runtime state that can be regenerated: `daemons/`, `locks/`, `client.log`, `update-check.json`

## Project scope

Project-scoped config is always at `<cwd>/.acolyte/config.toml`, regardless of platform. Project `.acolyte/` is workspace metadata, not global state.

## Key files

- `src/paths.ts` — path resolution logic
- `scripts/install.sh` — binary installation
