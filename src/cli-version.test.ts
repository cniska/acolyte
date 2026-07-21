import { afterEach, describe, expect, test } from "bun:test";
import { extractVersionFromPackageJsonText, formatVersionWithCommit, resolveCliVersion } from "./cli-version";

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

  test("resolveCliVersion prefers the compiled-in version over npm_package_version and package.json", () => {
    process.env.npm_package_version = "0.0.1-source";
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
