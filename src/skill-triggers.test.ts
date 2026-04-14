import { describe, expect, test } from "bun:test";
import { matchSkillTriggers } from "./skill-triggers";

describe("matchSkillTriggers", () => {
  test("matches build skill from keyword", () => {
    expect(matchSkillTriggers("implement the login feature")).toContain("build");
  });

  test("matches debug skill from keyword", () => {
    expect(matchSkillTriggers("fix bug in the parser")).toContain("debug");
  });

  test("matches git skill from keyword", () => {
    expect(matchSkillTriggers("commit these changes")).toContain("git");
  });

  test("matches multiple skills from message", () => {
    const matches = matchSkillTriggers("review the pull request and fix bug");
    expect(matches).toContain("review");
    expect(matches).toContain("debug");
  });

  test("is case insensitive", () => {
    expect(matchSkillTriggers("DEBUG this issue")).toContain("debug");
  });

  test("returns empty array for unrelated message", () => {
    expect(matchSkillTriggers("hello world")).toEqual([]);
  });

  test("skips already active skills", () => {
    const matches = matchSkillTriggers("implement the feature", [{ name: "build", instructions: "..." }]);
    expect(matches).not.toContain("build");
  });

  test("suggests non-active skills even when some are active", () => {
    const matches = matchSkillTriggers("implement the feature and commit", [{ name: "build", instructions: "..." }]);
    expect(matches).not.toContain("build");
    expect(matches).toContain("git");
  });
});
