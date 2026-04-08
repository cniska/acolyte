import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import { validateArchiveEntries } from "./update-ops";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

describe("validateArchiveEntries", () => {
  test("rejects archive with path traversal entry", async () => {
    const dir = dirs.createDir("acolyte-archive-");
    const tarPath = join(dir, "malicious.tar.gz");
    const py = Bun.spawn(
      [
        "python3",
        "-c",
        [
          "import tarfile, io, sys",
          `tf = tarfile.open(sys.argv[1], 'w:gz')`,
          `info = tarfile.TarInfo(name='acolyte'); info.size = 5`,
          `tf.addfile(info, io.BytesIO(b'legit'))`,
          `info2 = tarfile.TarInfo(name='../../escaped.txt'); info2.size = 5`,
          `tf.addfile(info2, io.BytesIO(b'pwned'))`,
          `tf.close()`,
        ].join("\n"),
        tarPath,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    await py.exited;

    await expect(validateArchiveEntries(tarPath)).rejects.toThrow(/unsafe archive entry/i);
  });

  test("accepts archive with safe entries", async () => {
    const dir = dirs.createDir("acolyte-archive-");
    const tarPath = join(dir, "safe.tar.gz");
    const py = Bun.spawn(
      [
        "python3",
        "-c",
        [
          "import tarfile, io, sys",
          `tf = tarfile.open(sys.argv[1], 'w:gz')`,
          `info = tarfile.TarInfo(name='acolyte'); info.size = 5`,
          `tf.addfile(info, io.BytesIO(b'legit'))`,
          `tf.close()`,
        ].join("\n"),
        tarPath,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    await py.exited;

    await expect(validateArchiveEntries(tarPath)).resolves.toBeUndefined();
  });
});
