# Paths

Acolyte resolves config, data, and state directories per-platform.

## macOS

Everything lives under `~/.acolyte/`:

| Category | Path |
|---|---|
| Config | `~/.acolyte/config.toml`, `~/.acolyte/credentials` |
| Data | `~/.acolyte/memory.db`, `~/.acolyte/sessions.json`, `~/.acolyte/trace.db`, `~/.acolyte/tool.db`, `~/.acolyte/projects/` |
| State | `~/.acolyte/daemons/`, `~/.acolyte/locks/`, `~/.acolyte/client.log`, `~/.acolyte/update-check.json` |
| Binary | `~/.acolyte/bin/acolyte` |

## Linux

Follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/). Environment variables override the defaults. Relative paths in XDG variables are ignored per spec.

| Category | Default | Env override |
|---|---|---|
| Config | `~/.config/acolyte/` | `$XDG_CONFIG_HOME/acolyte/` |
| Data | `~/.local/share/acolyte/` | `$XDG_DATA_HOME/acolyte/` |
| State | `~/.local/state/acolyte/` | `$XDG_STATE_HOME/acolyte/` |
| Binary | `~/.local/bin/acolyte` | — |

### What goes where

- **Config** — user-edited settings and credentials: `config.toml`, `credentials`
- **Data** — persistent application data: `memory.db`, `sessions.json`, `trace.db`, `tool.db`, `projects/`
- **State** — runtime state that can be regenerated: `daemons/`, `locks/`, `client.log`, `update-check.json`

## Project scope

Project-scoped config is always at `<cwd>/.acolyte/config.toml`, regardless of platform.

## Key files

- `src/paths.ts` — path resolution logic
- `scripts/install.sh` — binary installation
