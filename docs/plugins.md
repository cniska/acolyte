# Plugins

Acolyte loads Agent Plugins 1.0.0: portable directories that carry skills and MCP servers, shared with every client that reads the standard.

A plugin is a directory with a `plugin.json` manifest. Acolyte reads two component types from it — skills and MCP servers — and ignores anything else the standard or another client defines. The format is specified at [agent-plugins.org](https://agent-plugins.org); this page states what Acolyte does with it.

## Enabling plugins

Plugins are disabled by default:

```toml
[features]
plugins = true
```

A plugin's MCP servers additionally require `features.mcp`. With `plugins` on and `mcp` off, the plugin's skills load and its servers are absent.

Only enable plugins for trusted content. A plugin's `SKILL.md` files reach the model, and its `stdio` servers execute local commands.

## Where plugins live

| Scope | Location |
|-------|----------|
| project | `<workspace>/.agents/plugins/<dir>` |
| user | `~/.agents/plugins/<dir>` |

Each immediate child directory holding a `plugin.json` is one plugin; a symlink to a directory elsewhere loads the same as a real one. Installation is out of scope for the standard, so cloning a plugin anywhere and symlinking it into a plugins directory is the supported way to install one.

A plugin's identity is the `name` in its manifest, not its directory name. A project plugin shadows a user plugin claiming the same name.

## Layout

```
my-plugin/
├── plugin.json
├── skills/
│   └── <skill-name>/SKILL.md
└── mcp.json
```

`skills/` is read one level deep: each immediate child directory holding a `SKILL.md` is one skill, and deeper directories are never searched. Skills use the same format as `.agents/skills`, described in [Paths](./paths.md).

## Skills from plugins

A plugin skill joins the roster like any other, and the model activates it by name. Precedence runs from most to least deliberate:

| Rank | Source |
|------|--------|
| 1 | project skill in `.agents/skills` |
| 2 | user skill in `.agents/skills` |
| 3 | project plugin skill |
| 4 | user plugin skill |
| 5 | bundled skill |

A hand-placed skill may replace a built-in command of the same name; a plugin skill never does. When two plugins claim one skill name, the plugin whose directory sorts first wins — project scope before user scope — and the loss is counted in `acolyte status`.

## MCP servers from plugins

Servers are read from `mcp.json` at the plugin root and namespaced as `<plugin-name>-<server-name>`, so they cannot collide with servers in the workspace `.mcp.json`. A workspace server keeps a contested name.

| Standard transport | Acolyte |
|--------------------|---------|
| `stdio` | supported |
| `streamable-http` | supported, normalized to the `http` transport of [Configuration](./configuration.md) |
| `sse` | not supported; the server is skipped and the rest of the file still loads |

A `stdio` server's `command` is a bare executable name or a `./`-relative path inside the plugin. Its subprocess starts in the plugin root unless `cwd` says otherwise, receives the environment allowlist described in [Configuration](./configuration.md), and always receives `PLUGIN_ROOT` and `PLUGIN_DATA`.

`${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are substituted in `args`, `env` values, and `cwd`, once and without rescanning. A command or working directory that resolves outside the directory it names disables that server.

| Variable | Value |
|----------|-------|
| `PLUGIN_ROOT` | the plugin directory, with symlinks resolved |
| `PLUGIN_DATA` | `<workspace>/.acolyte/plugin-data/<name>` for a project plugin, `<data-dir>/plugins/<name>` for a user plugin |

`PLUGIN_DATA` is created before a server launches and is keyed by plugin name, so renaming a plugin gives it a new data directory. A project plugin's data is server state, not workspace configuration; ignore `.acolyte/plugin-data/` in version control.

## Invalid plugins

| Fault | Result |
|-------|--------|
| no `plugin.json` | the directory is not a plugin |
| manifest unreadable, invalid, or a version Acolyte does not support | the plugin is rejected whole |
| unknown top-level manifest field, or an `extensions` field that is not an object | reported, and the plugin loads |
| `mcp.json` unreadable, or its `$schema` or shape invalid | the plugin's servers are dropped, its skills still load |
| one server entry invalid or of an unsupported transport | that server is dropped, the others still load |
| skill that is not a valid `SKILL.md` | that skill is skipped, the others still load |

Counts for each are in `acolyte status` under `resources.plugins.*`, and every rejection is logged. Acolyte never fetches a schema while loading a plugin.

## Extensions

Acolyte reads no `extensions` data and no client-namespaced directories. Its own namespace is `sh.acolyte`.

## Key files

- `src/plugin-contract.ts` — manifest, `mcp.json`, and normalization contracts
- `src/plugin-ops.ts` — discovery, validation, and load diagnostics
- `src/skill-scan.ts` — the shared `SKILL.md` scanner
- `src/mcp-client.ts` — server resolution across the workspace and plugins

## Further reading

- [Configuration](./configuration.md) — feature flags and workspace MCP servers
- [Paths](./paths.md) — where skills and plugins are read from
- [Tooling](./tooling.md) — how MCP tools reach the model
