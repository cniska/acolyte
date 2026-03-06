import { describe, expect, test } from "bun:test";
import { extractVersionFromPackageJsonText, formatVersionWithCommit } from "./cli-version";

describe("cli-version", () => {
  test("extractVersionFromPackageJsonText parses version safely", () => {
    expect(extractVersionFromPackageJsonText('{"name":"acolyte","version":"0.1.0"}')).toBe("0.1.0");
    expect(extractVersionFromPackageJsonText('{"name":"acolyte"}')).toBeNull();
    expect(extractVersionFromPackageJsonText("{bad json}")).toBeNull();
  });

  test("formatVersionWithCommit appends short commit when available", () => {
    expect(formatVersionWithCommit("0.1.0", "abc1234")).toBe("0.1.0 (abc1234)");
    expect(formatVersionWithCommit("0.1.0", null)).toBe("0.1.0");
  });
});
