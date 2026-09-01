import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import {
  listStagedVersions,
  newestStagedVersion,
  pruneStagedVersions,
  stageBinary,
  stagedBinaryPath,
  stagingDir,
} from "./update-staging";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

function homeEnv(): { HOME: string } {
  return { HOME: dirs.createDir("acolyte-staging-") };
}

async function writeStaged(env: { HOME: string }, version: string, body = "#!/bin/sh\n"): Promise<void> {
  await mkdir(join(stagingDir(env), version), { recursive: true });
  await writeFile(stagedBinaryPath(version, env), body, { mode: 0o755 });
}

describe("listStagedVersions", () => {
  test("returns staged versions newest first", async () => {
    const env = homeEnv();
    await writeStaged(env, "0.9.0");
    await writeStaged(env, "0.11.0");
    await writeStaged(env, "0.10.2");

    expect(await listStagedVersions(env)).toEqual(["0.11.0", "0.10.2", "0.9.0"]);
    expect(await newestStagedVersion(env)).toBe("0.11.0");
  });

  test("ignores a directory holding no binary", async () => {
    const env = homeEnv();
    await mkdir(join(stagingDir(env), "0.12.0"), { recursive: true });

    expect(await listStagedVersions(env)).toEqual([]);
    expect(await newestStagedVersion(env)).toBeNull();
  });

  test("returns nothing when the staging directory is absent", async () => {
    expect(await listStagedVersions(homeEnv())).toEqual([]);
  });
});

describe("pruneStagedVersions", () => {
  test("removes older builds and keeps the one it prunes from", async () => {
    const env = homeEnv();
    await writeStaged(env, "0.9.0");
    await writeStaged(env, "0.10.0");
    await writeStaged(env, "0.11.0");

    await pruneStagedVersions("0.10.0", env);

    expect(await listStagedVersions(env)).toEqual(["0.11.0", "0.10.0"]);
  });

  test("leaves the staging directory untouched when nothing is older", async () => {
    const env = homeEnv();
    await writeStaged(env, "0.11.0");

    await pruneStagedVersions("0.9.0", env);

    expect(await listStagedVersions(env)).toEqual(["0.11.0"]);
  });
});

describe("stageBinary", () => {
  test("publishes an executable under its version and leaves no partial copy", async () => {
    const env = homeEnv();
    const source = join(dirs.createDir("acolyte-source-"), "acolyte");
    await writeFile(source, "#!/bin/sh\necho staged\n");

    const staged = await stageBinary(source, "0.13.0", env);

    expect(staged).toBe(stagedBinaryPath("0.13.0", env));
    expect(await Bun.file(staged).text()).toBe("#!/bin/sh\necho staged\n");
    expect((await stat(staged)).mode & 0o111).not.toBe(0);
    expect(await Bun.file(`${staged}.partial`).exists()).toBe(false);
  });
});
