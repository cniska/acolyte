import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import { computeFileChecksum, validateArchiveEntries } from "./update-ops";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

describe("computeFileChecksum", () => {
  test("returns correct sha256 for known content", async () => {
    const dir = dirs.createDir("acolyte-checksum-");
    const filePath = join(dir, "test.bin");
    await writeFile(filePath, "test-content", "utf8");

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update("test-content");
    const expected = hasher.digest("hex");

    expect(await computeFileChecksum(filePath)).toBe(expected);
  });

  test("returns different hash for different content", async () => {
    const dir = dirs.createDir("acolyte-checksum-");
    const fileA = join(dir, "a.bin");
    const fileB = join(dir, "b.bin");
    await writeFile(fileA, "content-a", "utf8");
    await writeFile(fileB, "content-b", "utf8");

    const hashA = await computeFileChecksum(fileA);
    const hashB = await computeFileChecksum(fileB);
    expect(hashA).not.toBe(hashB);
  });
});

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
