import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import { computeFileChecksum, parseChecksumFile } from "./update-ops";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

describe("parseChecksumFile", () => {
  test("extracts hash from standard checksum format", () => {
    expect(parseChecksumFile("abc123  acolyte-darwin-arm64.tar.gz\n")).toBe("abc123");
  });

  test("extracts hash when only hash is present", () => {
    expect(parseChecksumFile("abc123\n")).toBe("abc123");
  });

  test("throws on empty content", () => {
    expect(() => parseChecksumFile("")).toThrow(/empty or malformed/);
  });

  test("throws on whitespace-only content", () => {
    expect(() => parseChecksumFile("   \n  ")).toThrow(/empty or malformed/);
  });
});

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
