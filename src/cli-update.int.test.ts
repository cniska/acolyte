import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliUpdateInternals } from "./cli-update";
import { startTestServer } from "./test-utils";

describe("verifyChecksum", () => {
  test("throws when checksum endpoint returns non-ok status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-update-"));
    const filePath = join(dir, "test.tar.gz");
    await writeFile(filePath, "test-content", "utf8");

    const server = startTestServer(() => new Response("not found", { status: 404 }));
    try {
      await expect(
        cliUpdateInternals.verifyChecksum(filePath, `http://127.0.0.1:${server.port}/checksum`),
      ).rejects.toThrow();
    } finally {
      server.stop();
    }
  });

  test("throws when checksum endpoint is unreachable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-update-"));
    const filePath = join(dir, "test.tar.gz");
    await writeFile(filePath, "test-content", "utf8");

    await expect(cliUpdateInternals.verifyChecksum(filePath, "http://127.0.0.1:1/checksum")).rejects.toThrow();
  });

  test("throws when checksum does not match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-update-"));
    const filePath = join(dir, "test.tar.gz");
    await writeFile(filePath, "test-content", "utf8");

    const server = startTestServer(() => new Response("deadbeef  test.tar.gz\n"));
    try {
      await expect(
        cliUpdateInternals.verifyChecksum(filePath, `http://127.0.0.1:${server.port}/checksum`),
      ).rejects.toThrow(/checksum mismatch/i);
    } finally {
      server.stop();
    }
  });

  test("passes when checksum matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-update-"));
    const filePath = join(dir, "test.tar.gz");
    const content = "test-content";
    await writeFile(filePath, content, "utf8");

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(content);
    const expected = hasher.digest("hex");

    const server = startTestServer(() => new Response(`${expected}  test.tar.gz\n`));
    try {
      await expect(
        cliUpdateInternals.verifyChecksum(filePath, `http://127.0.0.1:${server.port}/checksum`),
      ).resolves.toBeUndefined();
    } finally {
      server.stop();
    }
  });
});

describe("extractBinary", () => {
  test("rejects archive containing path traversal entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-extract-"));
    const outDir = join(dir, "out");
    await mkdir(outDir, { recursive: true });

    // Use python to create a tar with a literal ../../ entry (not possible with tar CLI)
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

    await expect(cliUpdateInternals.extractBinary(tarPath, outDir)).rejects.toThrow(/unsafe archive entry/i);
  });

  test("rejects archive missing the acolyte binary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-extract-"));
    const outDir = join(dir, "out");
    await mkdir(outDir, { recursive: true });

    const srcDir = join(dir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "not-acolyte"), "wrong-name");

    const tarPath = join(dir, "wrong.tar.gz");
    const proc = Bun.spawn(["tar", "czf", tarPath, "-C", srcDir, "not-acolyte"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    await expect(cliUpdateInternals.extractBinary(tarPath, outDir)).rejects.toThrow();
  });

  test("accepts valid archive with only the acolyte binary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-extract-"));
    const outDir = join(dir, "out");
    await mkdir(outDir, { recursive: true });

    const srcDir = join(dir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "acolyte"), "valid-binary");

    const tarPath = join(dir, "good.tar.gz");
    const proc = Bun.spawn(["tar", "czf", tarPath, "-C", srcDir, "acolyte"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;

    const result = await cliUpdateInternals.extractBinary(tarPath, outDir);
    expect(result).toBe(join(outDir, "acolyte"));
    expect(existsSync(join(outDir, "acolyte"))).toBe(true);
  });
});
