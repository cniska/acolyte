import { chmod, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { APP_NAME } from "./app-contract";
import { compareVersions } from "./cli-version";
import { dataDir, type Env } from "./paths";

/** Holds staged builds only. An installer's own binary lives outside it, so pruning here can never
 *  remove the copy the launcher falls back to. */
export function stagingDir(env: Env = process.env): string {
  return join(dataDir(env), "bin");
}

export function stagedBinaryPath(version: string, env: Env = process.env): string {
  return join(stagingDir(env), version, APP_NAME);
}

/** Staged versions, newest first. */
export async function listStagedVersions(env: Env = process.env): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(stagingDir(env));
  } catch {
    return [];
  }
  const staged: string[] = [];
  for (const entry of entries) {
    if (await Bun.file(stagedBinaryPath(entry, env)).exists()) staged.push(entry);
  }
  return staged.sort((a, b) => compareVersions(b, a));
}

export async function newestStagedVersion(env: Env = process.env): Promise<string | null> {
  return (await listStagedVersions(env))[0] ?? null;
}

/** Drops staged builds older than `keepFrom`. The launcher would never pick them, and keeping
 *  `keepFrom` itself means a caller can prune from the version it is about to hand over to. */
export async function pruneStagedVersions(keepFrom: string, env: Env = process.env): Promise<void> {
  for (const version of await listStagedVersions(env)) {
    if (compareVersions(version, keepFrom) < 0)
      await rm(join(stagingDir(env), version), { recursive: true, force: true });
  }
}

/** Publishes the binary under its version by rename, so a half-written copy is never launchable. */
export async function stageBinary(sourcePath: string, version: string, env: Env = process.env): Promise<string> {
  const target = stagedBinaryPath(version, env);
  const partial = `${target}.partial`;
  await mkdir(join(stagingDir(env), version), { recursive: true });
  await copyFile(sourcePath, partial);
  await chmod(partial, 0o755);
  await rename(partial, target);
  return target;
}
