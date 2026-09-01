import { describe, expect, test } from "bun:test";
import { repositoryLabel } from "./git-remote";

describe("repositoryLabel", () => {
  test("names one repository the same however it is addressed", () => {
    const expected = "acolyte-sh/acolyte";
    expect(repositoryLabel("https://github.com/acolyte-sh/acolyte.git")).toBe(expected);
    expect(repositoryLabel("git@github.com:acolyte-sh/acolyte.git")).toBe(expected);
    expect(repositoryLabel("ssh://git@github.com/acolyte-sh/acolyte")).toBe(expected);
    expect(repositoryLabel("git://github.com/acolyte-sh/acolyte.git")).toBe(expected);
    expect(repositoryLabel("https://GitHub.com/acolyte-sh/acolyte/")).toBe(expected);
    expect(repositoryLabel("https://user:token@github.com/acolyte-sh/acolyte.git")).toBe(expected);
    expect(repositoryLabel("ssh://git@github.com:2222/acolyte-sh/acolyte.git")).toBe(expected);
  });

  test("names one repository the same on any forge", () => {
    expect(repositoryLabel("https://gitlab.com/acolyte-sh/acolyte.git")).toBe("acolyte-sh/acolyte");
    expect(repositoryLabel("https://GitHub.com/Acolyte-SH/Acolyte.git")).toBe("acolyte-sh/acolyte");
  });

  test("has no identity to share for a local or empty remote", () => {
    expect(repositoryLabel("/srv/git/repo.git")).toBeNull();
    expect(repositoryLabel("file:///srv/git/repo.git")).toBeNull();
    expect(repositoryLabel("https://github.com/")).toBeNull();
    expect(repositoryLabel("git@host:repo.git")).toBeNull();
    expect(repositoryLabel("  ")).toBeNull();
  });
});
