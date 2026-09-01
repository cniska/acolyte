import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { APP_NAME } from "./app-contract";
import { compareVersions } from "./cli-version";
import { dataDir, type Env } from "./paths";

/** Holds staged builds only. An installer's own binary lives outside it, so pruning here can never
 *  remove the copy the launcher falls back to. */
export function stagingDir(env: Env = process.env): string {
  return join(dataDir(env), "bin");
}

export function stagedVersionDir(version: string, env: Env = process.env): string {
  return join(stagingDir(env), version);
}

export function stagedBinaryPath(version: string, env: Env = process.env): string {
  return join(stagedVersionDir(version, env), APP_NAME);
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

export async function isVersionStaged(version: string, env: Env = process.env): Promise<boolean> {
  return await Bun.file(stagedBinaryPath(version, env)).exists();
}

/** Drops staged builds the launcher will not choose again: everything no newer than the running
 *  build, except the directory this process was launched from — removing that one would send the
 *  next start back to the baseline to download the same release again. */
export async function pruneStagedVersions(
  runningVersion: string,
  env: Env = process.env,
  execPath: string = process.execPath,
): Promise<void> {
  const runningDir = dirname(execPath);
  for (const version of await listStagedVersions(env)) {
    const dir = stagedVersionDir(version, env);
    if (compareVersions(version, runningVersion) > 0 || dir === runningDir) continue;
    await rm(dir, { recursive: true, force: true });
  }
}

/** The version grammar the launcher can order. Its comparison reads three numeric fields, so a
 *  prerelease would rank equal to its release and the two would take turns winning; refusing to
 *  stage one keeps every implementation of that comparison honest. */
const STAGEABLE_VERSION = /^\d+\.\d+\.\d+$/;

/** Publishes the binary under its version by rename, so a half-written copy is never launchable. */
export async function stageBinary(sourcePath: string, version: string, env: Env = process.env): Promise<string> {
  if (!STAGEABLE_VERSION.test(version)) throw new Error(`Refusing to stage unorderable version ${version}`);
  const target = stagedBinaryPath(version, env);
  // Two clients can stage the same release at once; a shared scratch name would let one rename a
  // copy the other is still truncating. Renaming distinct files onto one target is safe.
  const partial = `${target}.${randomUUID()}.partial`;
  await mkdir(stagedVersionDir(version, env), { recursive: true });
  try {
    await copyFile(sourcePath, partial);
    await chmod(partial, 0o755);
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return target;
}
