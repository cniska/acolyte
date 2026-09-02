import { afterEach, describe, expect, test } from "bun:test";
import {
  compareVersions,
  extractVersionFromPackageJsonText,
  formatVersionWithCommit,
  resolveCliVersion,
} from "./cli-version";

describe("compareVersions", () => {
  test("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.13.0", "0.12.9")).toBe(1);
    expect(compareVersions("0.12.1", "0.12.0")).toBe(1);
    expect(compareVersions("0.12.0", "0.12.1")).toBe(-1);
  });

  test("treats equal versions as equal, with or without a v prefix", () => {
    expect(compareVersions("0.12.0", "0.12.0")).toBe(0);
    expect(compareVersions("v0.12.0", "0.12.0")).toBe(0);
    expect(compareVersions("0.12.0", "v0.12.0")).toBe(0);
  });

  test("reads a missing or non-numeric field as zero", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("dev", "0.0.1")).toBe(-1);
    expect(compareVersions("0.12.0", "dev")).toBe(1);
  });
});

describe("cli-version", () => {
  const originalNpmVersion = process.env.npm_package_version;

  afterEach(() => {
    delete process.env.ACOLYTE_COMPILED_VERSION;
    if (originalNpmVersion === undefined) delete process.env.npm_package_version;
    else process.env.npm_package_version = originalNpmVersion;
  });

  test("extractVersionFromPackageJsonText parses version safely", () => {
    expect(extractVersionFromPackageJsonText('{"name":"acolyte","version":"0.1.0"}')).toBe("0.1.0");
    expect(extractVersionFromPackageJsonText('{"name":"acolyte"}')).toBeNull();
    expect(extractVersionFromPackageJsonText("{bad json}")).toBeNull();
  });

  test("resolveCliVersion prefers the compiled-in version over the install's package.json", () => {
    process.env.ACOLYTE_COMPILED_VERSION = "1.2.3";
    expect(resolveCliVersion()).toBe("1.2.3");
  });

  test("resolveCliVersion ignores a blank compiled-in version", () => {
    delete process.env.ACOLYTE_COMPILED_VERSION;
    const fallback = resolveCliVersion();
    process.env.ACOLYTE_COMPILED_VERSION = "   ";
    expect(resolveCliVersion()).toBe(fallback);
  });

  test("formatVersionWithCommit appends short commit when available", () => {
    expect(formatVersionWithCommit("0.1.0", "abc1234")).toBe("0.1.0 (abc1234)");
    expect(formatVersionWithCommit("0.1.0", null)).toBe("0.1.0");
  });
});
