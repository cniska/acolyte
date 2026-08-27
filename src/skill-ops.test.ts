import { describe, expect, test } from "bun:test";
import { createEmptySkillLoadDiagnostics, type SkillMeta, type SkillSource, validateSkillName } from "./skill-contract";
import { mergeSkills, substituteArguments } from "./skill-ops";

function skill(name: string, source: SkillSource, plugin?: string): SkillMeta {
  return {
    name,
    description: `${name} description`,
    path: source === "bundled" ? `bundled://${name}` : `/${source}/${name}/SKILL.md`,
    source,
    ...(plugin ? { plugin } : {}),
  };
}

function sourceOf(skills: SkillMeta[], name: string): SkillSource | undefined {
  return skills.find((entry) => entry.name === name)?.source;
}

describe("mergeSkills", () => {
  test("keeps every name claimed once, sorted", () => {
    const merged = mergeSkills(
      [skill("review", "bundled")],
      [skill("lint", "plugin", "acme.tools")],
      [skill("deploy", "project")],
      createEmptySkillLoadDiagnostics(),
    );
    expect(merged.map((entry) => entry.name)).toEqual(["deploy", "lint", "review"]);
  });

  test("a hand-placed skill outranks a plugin skill of the same name", () => {
    const diagnostics = createEmptySkillLoadDiagnostics();
    const merged = mergeSkills([], [skill("build", "plugin", "acme.tools")], [skill("build", "project")], diagnostics);
    expect(merged).toHaveLength(1);
    expect(sourceOf(merged, "build")).toBe("project");
    expect(diagnostics.overrides).toBe(1);
  });

  test("a plugin skill outranks a bundled skill of the same name", () => {
    const diagnostics = createEmptySkillLoadDiagnostics();
    const merged = mergeSkills([skill("build", "bundled")], [skill("build", "plugin", "acme.tools")], [], diagnostics);
    expect(merged).toHaveLength(1);
    expect(sourceOf(merged, "build")).toBe("plugin");
    expect(diagnostics.overrides).toBe(1);
  });

  test("a hand-placed skill outranks bundled and plugin at once", () => {
    const merged = mergeSkills(
      [skill("build", "bundled")],
      [skill("build", "plugin", "acme.tools")],
      [skill("build", "user")],
      createEmptySkillLoadDiagnostics(),
    );
    expect(merged).toHaveLength(1);
    expect(sourceOf(merged, "build")).toBe("user");
  });

  test("a skill named after a builtin command loads from any source", () => {
    const merged = mergeSkills([], [skill("status", "plugin", "acme.tools")], [], createEmptySkillLoadDiagnostics());
    expect(sourceOf(merged, "status")).toBe("plugin");
  });
});

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
