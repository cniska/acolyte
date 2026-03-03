import { describe, expect, test } from "bun:test";
import { substituteArguments, validateSkillName } from "./skills";

describe("validateSkillName", () => {
  test("accepts valid names", () => {
    expect(validateSkillName("dogfood", "dogfood")).toBeNull();
    expect(validateSkillName("pdf-processing", "pdf-processing")).toBeNull();
    expect(validateSkillName("a", "a")).toBeNull();
    expect(validateSkillName("my-skill-123", "my-skill-123")).toBeNull();
  });

  test("rejects empty or too-long names", () => {
    expect(validateSkillName("", "")).not.toBeNull();
    expect(validateSkillName("a".repeat(65), "a".repeat(65))).not.toBeNull();
  });

  test("rejects uppercase", () => {
    expect(validateSkillName("MySkill", "MySkill")).not.toBeNull();
  });

  test("rejects leading/trailing hyphens", () => {
    expect(validateSkillName("-start", "-start")).not.toBeNull();
    expect(validateSkillName("end-", "end-")).not.toBeNull();
  });

  test("rejects consecutive hyphens", () => {
    expect(validateSkillName("my--skill", "my--skill")).not.toBeNull();
  });

  test("rejects name/directory mismatch", () => {
    expect(validateSkillName("foo", "bar")).not.toBeNull();
  });
});

describe("substituteArguments", () => {
  test("replaces $ARGUMENTS placeholder", () => {
    expect(substituteArguments("Do: $ARGUMENTS", "run tests")).toBe("Do: run tests");
  });

  test("returns unchanged when no placeholder", () => {
    expect(substituteArguments("No placeholder", "args")).toBe("No placeholder");
  });

  test("replaces multiple occurrences", () => {
    expect(substituteArguments("$ARGUMENTS and $ARGUMENTS", "x")).toBe("x and x");
  });
});
