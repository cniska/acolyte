import { describe, expect, test } from "bun:test";
import { parseChecksumFile } from "./update-ops";

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
