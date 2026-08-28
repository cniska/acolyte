export const SERVE_COMMAND = "serve";

/** Bun mounts a standalone build's modules on a virtual filesystem, so `import.meta.dir` names no
 *  path any runtime can execute: such a build re-runs its own binary to reach the server. */
const EMBEDDED_MODULE_DIR_PREFIX = "/$bunfs/";

export function isEmbeddedModuleDir(dir: string): boolean {
  return dir.startsWith(EMBEDDED_MODULE_DIR_PREFIX);
}

export function serverSpawnCommand(execPath: string = process.execPath, moduleDir: string = import.meta.dir): string[] {
  if (isEmbeddedModuleDir(moduleDir)) return [execPath, SERVE_COMMAND];
  return [execPath, "run", `${moduleDir}/cli.ts`, SERVE_COMMAND];
}
