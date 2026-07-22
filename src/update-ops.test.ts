import { describe, expect, test } from "bun:test";
import { installUpdate, isSelfUpdatableBinary, parseChecksumFile } from "./update-ops";

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

describe("isSelfUpdatableBinary", () => {
  test("accepts a binary named acolyte", () => {
    expect(isSelfUpdatableBinary("/Users/me/.acolyte/bin/acolyte")).toBe(true);
    expect(isSelfUpdatableBinary("acolyte")).toBe(true);
  });

  test("rejects a runtime it must never overwrite", () => {
    expect(isSelfUpdatableBinary("/opt/homebrew/Cellar/bun/1.3.14/bin/bun")).toBe(false);
    expect(isSelfUpdatableBinary("/usr/local/bin/node")).toBe(false);
  });
});

describe("installUpdate", () => {
  test("refuses to overwrite the runtime when not the acolyte binary", async () => {
    expect(isSelfUpdatableBinary(process.execPath)).toBe(false);
    const result = await installUpdate("https://invalid.example/acolyte.tar.gz", null);
    expect(result.success).toBe(false);
    expect(result.error).toContain("refusing to overwrite");
  });
});
