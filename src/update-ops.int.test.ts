import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startTestServer, tempDir } from "./test-utils";
import { stageUpdate } from "./update-ops";
import { listStagedVersions, stagedBinaryPath, stagingDir } from "./update-staging";

const dirs = tempDir();
const sharedDataHome = process.env.XDG_DATA_HOME;

// The preload pins XDG_DATA_HOME to one home shared by the whole suite, so a test that stages a
// binary has to claim its own or it both sees and leaves builds that belong to other tests.
function useOwnDataHome(): void {
  process.env.XDG_DATA_HOME = dirs.createDir("acolyte-update-data-");
}

afterEach(() => {
  if (sharedDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = sharedDataHome;
  dirs.cleanupDirs();
});

const BINARY_BODY = "#!/bin/sh\necho released\n";

/** A release tarball holding exactly the one entry `extractBinary` accepts. */
async function createRelease(): Promise<{ tarball: ArrayBuffer; checksum: string }> {
  const dir = dirs.createDir("acolyte-release-");
  const payload = join(dir, "acolyte");
  await writeFile(payload, BINARY_BODY);
  await chmod(payload, 0o755);
  const tarPath = join(dir, "release.tar.gz");
  const tar = Bun.spawn(["tar", "czf", tarPath, "-C", dir, "acolyte"], { stdout: "ignore", stderr: "pipe" });
  expect(await tar.exited).toBe(0);

  const tarball = await Bun.file(tarPath).arrayBuffer();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(new Uint8Array(tarball));
  return { tarball, checksum: hasher.digest("hex") };
}

describe("stageUpdate", () => {
  test("stages a verified release under its version", async () => {
    useOwnDataHome();
    const { tarball, checksum } = await createRelease();
    const server = startTestServer((req) =>
      new URL(req.url).pathname.endsWith(".sha256")
        ? new Response(`${checksum}  acolyte.tar.gz\n`)
        : new Response(tarball),
    );
    await mkdir(join(stagingDir(), "0.1.0"), { recursive: true });
    await writeFile(stagedBinaryPath("0.1.0"), "stale", { mode: 0o755 });

    try {
      const result = await stageUpdate(
        `http://127.0.0.1:${server.port}/acolyte.tar.gz`,
        `http://127.0.0.1:${server.port}/acolyte.sha256`,
        "0.27.0",
      );

      expect(result).toEqual({ success: true });
      expect(await Bun.file(stagedBinaryPath("0.27.0")).text()).toBe(BINARY_BODY);
      // Staging only publishes; the start that runs the new build is what clears what it replaced.
      expect(await listStagedVersions()).toEqual(["0.27.0", "0.1.0"]);
    } finally {
      server.stop();
    }
  });

  test("stages nothing when the checksum does not match the download", async () => {
    useOwnDataHome();
    const { tarball } = await createRelease();
    const server = startTestServer((req) =>
      new URL(req.url).pathname.endsWith(".sha256")
        ? new Response(`${"0".repeat(64)}  acolyte.tar.gz\n`)
        : new Response(tarball),
    );

    try {
      const result = await stageUpdate(
        `http://127.0.0.1:${server.port}/acolyte.tar.gz`,
        `http://127.0.0.1:${server.port}/acolyte.sha256`,
        "0.27.0",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Checksum mismatch");
      expect(await listStagedVersions()).toEqual([]);
    } finally {
      server.stop();
    }
  });
});
