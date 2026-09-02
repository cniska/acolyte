import { describe, expect, test } from "bun:test";
import { resolveAssetName } from "./cli-update";

describe("resolveAssetName", () => {
  test("returns a valid asset name", () => {
    const name = resolveAssetName();
    expect(name).toMatch(/^acolyte-(darwin|linux)-(arm64|x64)\.tar\.gz$/);
  });
});
