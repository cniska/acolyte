import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
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
