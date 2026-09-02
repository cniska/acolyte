import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
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
  const elsewhere = "/usr/local/bin/acolyte";

  test("removes every build the running one has caught up with", async () => {
    const env = homeEnv();
    await writeStaged(env, "0.9.0");
    await writeStaged(env, "0.10.0");
    await writeStaged(env, "0.11.0");

    await pruneStagedVersions("0.10.0", env, elsewhere);

    expect(await listStagedVersions(env)).toEqual(["0.11.0"]);
  });

  // The baseline catching up to a staged build leaves it unreachable: the launcher breaks the tie
  // toward the baseline, so keeping it would strand a copy of the binary nothing can run.
  test("removes a build the running one merely matches", async () => {
    const env = homeEnv();
    await writeStaged(env, "0.11.0");

    await pruneStagedVersions("0.11.0", env, elsewhere);

    expect(await listStagedVersions(env)).toEqual([]);
  });

  test("keeps the build this process was launched from", async () => {
    const env = homeEnv();
    await writeStaged(env, "0.11.0");

    await pruneStagedVersions("0.11.0", env, stagedBinaryPath("0.11.0", env));

    expect(await listStagedVersions(env)).toEqual(["0.11.0"]);
  });

  test("leaves a build newer than the running one", async () => {
    const env = homeEnv();
    await writeStaged(env, "0.11.0");

    await pruneStagedVersions("0.9.0", env, elsewhere);

    expect(await listStagedVersions(env)).toEqual(["0.11.0"]);
  });
});

describe("stageBinary", () => {
  test("refuses a version the launcher could not order", async () => {
    const env = homeEnv();
    const source = join(dirs.createDir("acolyte-source-"), "acolyte");
    await writeFile(source, "#!/bin/sh\n");

    for (const version of ["1.0.0-rc.1", "1.0", "latest", "v1.0.0"]) {
      await expect(stageBinary(source, version, env)).rejects.toThrow(/unorderable version/);
    }
    expect(await listStagedVersions(env)).toEqual([]);
  });

  test("publishes an executable under its version and leaves no partial copy", async () => {
    const env = homeEnv();
    const source = join(dirs.createDir("acolyte-source-"), "acolyte");
    await writeFile(source, "#!/bin/sh\necho staged\n");

    const staged = await stageBinary(source, "0.13.0", env);

    expect(staged).toBe(stagedBinaryPath("0.13.0", env));
    expect(await Bun.file(staged).text()).toBe("#!/bin/sh\necho staged\n");
    expect((await stat(staged)).mode & 0o111).not.toBe(0);
    expect(await readdir(join(stagingDir(env), "0.13.0"))).toEqual(["acolyte"]);
  });

  test("publishes one whole binary when stagers race on the same version", async () => {
    const env = homeEnv();
    const dir = dirs.createDir("acolyte-source-");
    const bodies = Array.from({ length: 8 }, (_, index) => `#!/bin/sh\necho staged-${index}\n`.padEnd(64_000, "#"));
    const sources = await Promise.all(
      bodies.map(async (body, index) => {
        const path = join(dir, `acolyte-${index}`);
        await writeFile(path, body);
        return path;
      }),
    );

    await Promise.all(sources.map((source) => stageBinary(source, "0.13.0", env)));

    expect(bodies).toContain(await Bun.file(stagedBinaryPath("0.13.0", env)).text());
    expect(await readdir(join(stagingDir(env), "0.13.0"))).toEqual(["acolyte"]);
  });
});
