import { describe, expect, test } from "bun:test";
import { hermeticGitEnv } from "./git-ops";

describe("hermeticGitEnv", () => {
  test("points every git config file at nothing", () => {
    expect(hermeticGitEnv()).toEqual({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    });
  });

  test("keeps caller overrides", () => {
    expect(hermeticGitEnv({ GIT_CEILING_DIRECTORIES: "/scratch" })).toMatchObject({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CEILING_DIRECTORIES: "/scratch",
    });
  });

  test("lets a caller override a pinned key", () => {
    expect(hermeticGitEnv({ GIT_CONFIG_GLOBAL: "/custom" }).GIT_CONFIG_GLOBAL).toBe("/custom");
  });
});
