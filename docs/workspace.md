# Workspace

Defines how Acolyte resolves, scopes, and enforces workspace behavior.

## Workspace root

Each request runs with one workspace root directory.

If no workspace is provided, Acolyte uses the current working directory.
When a workspace path is provided, it must exist and be a directory.

## Detection

Workspace behavior has two detection layers:

1. Root detection:
The runtime resolves the active workspace from request input (`workspace`) or defaults to process CWD.

2. Profile detection:
The workspace detector infers ecosystem and commands (format/lint/test, package manager) from project files and caches the result per workspace for reuse.

## Sandbox

Tool filesystem access is scoped to the workspace root.

Access inside the workspace is allowed. Access outside the workspace is denied.
This rule is enforced across tool entry paths, including CLI tool mode (`acolyte tool ...`).

Path checks are fail-closed and use resolved-path validation (`realpath`) so symlink escapes are blocked. For paths that do not exist yet, validation resolves the nearest existing parent and enforces the same boundary.

For `shell-run`, Acolyte executes argv (`cmd` + `args`) without shell evaluation. The command path and path-like arguments are validated against the workspace sandbox, and execution runs with a restricted environment allowlist. This is command-level enforcement, not kernel-level process isolation, and it does not constrain filesystem access performed internally by the executed binary.

No special temp-root exception exists in sandbox enforcement.

## Sandbox violations

Boundary violations are returned as structured tool errors:

- `code`: `E_SANDBOX_VIOLATION`
- `kind`: `sandbox_violation`

## Workspace profile

Acolyte detects and stores a workspace profile with:

- ecosystem
- package manager
- format command
- lint command
- test command

The profile is used by lifecycle effects and tooling behavior, including format/lint runs on edited files and scoped test execution through detected test commands.

Profile detection is implemented by workspace detector modules and exposed via `resolveWorkspaceProfile`.

## Observability

Workspace and sandbox behavior is visible in lifecycle debug/trace events:

- `lifecycle.workspace.profile`
- `lifecycle.workspace.sandbox`
- `lifecycle.sandbox.violation`

## Key files

- `src/workspace-profile.ts` — profile type and resolution
- `src/workspace-detectors.ts` — ecosystem detection from project files
- `src/workspace-sandbox.ts` — path validation and sandbox enforcement

## Further reading

- [Know the Ground](https://crisu.me/blog/know-the-ground) — why the host should detect formatters, linters, and test runners from config files
- [Draw the Line](https://crisu.me/blog/draw-the-line) — lightweight workspace-scoped sandbox enforcement without containers
