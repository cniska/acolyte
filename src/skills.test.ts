import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listSkills, readSkillInstructions, substituteArguments, validateSkillName } from "./skills";
import { tempDir, writeSkill } from "./test-factory";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

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

describe("skills loader", () => {
  test("returns empty when skills directory is missing", async () => {
    const dir = createDir("acolyte-skills-empty-");
    const skills = await listSkills(dir);
    expect(skills).toEqual([]);
  });

  test("reads name/description from SKILL.md frontmatter", async () => {
    const dir = createDir("acolyte-skills-one-");
    writeSkill(dir, "demo", "---\nname: demo\ndescription: Demo description\n---", "# Demo");
    const skills = await listSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("demo");
    expect(skills[0]?.description).toBe("Demo description");
  });

  test("scans .agents/skills/ directory", async () => {
    const dir = createDir("acolyte-skills-agents-");
    const skillDir = join(dir, ".agents", "skills", "helper");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: helper\ndescription: Helper skill\n---\n# Help", "utf8");
    const skills = await listSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("helper");
  });

  test("deduplicates by name (first wins)", async () => {
    const dir = createDir("acolyte-skills-dedup-");
    writeSkill(dir, "demo", "---\nname: demo\ndescription: From skills/\n---");
    const agentDir = join(dir, ".agents", "skills", "demo");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "SKILL.md"), "---\nname: demo\ndescription: From .agents/skills/\n---", "utf8");
    const skills = await listSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("From skills/");
  });

  test("skips skills with invalid names", async () => {
    const dir = createDir("acolyte-skills-invalid-");
    writeSkill(dir, "Bad-Name", "---\nname: Bad-Name\ndescription: Invalid\n---");
    writeSkill(dir, "good", "---\nname: good\ndescription: Valid\n---");
    const skills = await listSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("good");
  });

  test("skips skills where name mismatches directory", async () => {
    const dir = createDir("acolyte-skills-mismatch-");
    writeSkill(dir, "foo", "---\nname: bar\ndescription: Mismatched\n---");
    const skills = await listSkills(dir);
    expect(skills).toEqual([]);
  });

  test("parses optional fields: license, compatibility, metadata, allowed-tools", async () => {
    const dir = createDir("acolyte-skills-optional-");
    const fm = [
      "---",
      "name: full",
      "description: Full spec skill",
      "license: MIT",
      "compatibility: Requires git",
      "allowed-tools: Bash Read Write",
      "metadata:",
      "  author: test-org",
      '  version: "1.0"',
      "---",
    ].join("\n");
    writeSkill(dir, "full", fm);
    const skills = await listSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.license).toBe("MIT");
    expect(skills[0]?.compatibility).toBe("Requires git");
    expect(skills[0]?.allowedTools).toEqual(["Bash", "Read", "Write"]);
    expect(skills[0]?.metadata).toEqual({ author: "test-org", version: "1.0" });
  });
});

describe("readSkillInstructions", () => {
  test("strips frontmatter and returns body", async () => {
    const dir = createDir("acolyte-skills-body-");
    const file = join(dir, "SKILL.md");
    writeFileSync(file, "---\nname: demo\ndescription: Demo\n---\n\n# Demo\nUse this skill.", "utf8");
    const body = await readSkillInstructions(file);
    expect(body).toBe("# Demo\nUse this skill.");
  });

  test("substitutes $ARGUMENTS when args provided", async () => {
    const dir = createDir("acolyte-skills-args-");
    const file = join(dir, "SKILL.md");
    writeFileSync(file, "---\nname: demo\ndescription: Demo\n---\n\nDo: $ARGUMENTS", "utf8");
    const body = await readSkillInstructions(file, "run tests");
    expect(body).toBe("Do: run tests");
  });

  test("cleans $ARGUMENTS placeholder when args is empty string", async () => {
    const dir = createDir("acolyte-skills-empty-args-");
    const file = join(dir, "SKILL.md");
    writeFileSync(file, "---\nname: demo\ndescription: Demo\n---\n\nDo: $ARGUMENTS", "utf8");
    const body = await readSkillInstructions(file, "");
    expect(body).toBe("Do: ");
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
