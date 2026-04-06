import { describe, expect, test } from "bun:test";
import { compareSemver, resolveAssetName } from "./cli-update";

describe("compareSemver", () => {
  test("returns true when latest is newer (patch)", () => {
    expect(compareSemver("0.12.0", "0.12.1")).toBe(true);
  });

  test("returns true when latest is newer (minor)", () => {
    expect(compareSemver("0.12.0", "0.13.0")).toBe(true);
  });

  test("returns true when latest is newer (major)", () => {
    expect(compareSemver("0.12.0", "1.0.0")).toBe(true);
  });

  test("returns false when versions are equal", () => {
    expect(compareSemver("0.12.0", "0.12.0")).toBe(false);
  });

  test("returns false when current is newer", () => {
    expect(compareSemver("0.13.0", "0.12.0")).toBe(false);
  });

  test("handles v prefix on latest", () => {
    expect(compareSemver("0.12.0", "v0.13.0")).toBe(true);
  });

  test("handles v prefix on current", () => {
    expect(compareSemver("v0.12.0", "0.13.0")).toBe(true);
  });
});

describe("resolveAssetName", () => {
  test("returns a valid asset name", () => {
    const name = resolveAssetName();
    expect(name).toMatch(/^acolyte-(darwin|linux)-(arm64|x64)\.tar\.gz$/);
  });
});
