import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills, readSkillInstructions } from "./skills";

describe("skills loader", () => {
  test("returns empty when skills directory is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-skills-empty-"));
    try {
      const skills = await listSkills(dir);
      expect(skills).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads name/description from SKILL.md frontmatter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-skills-one-"));
    try {
      const skillDir = join(dir, "skills", "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        ["---", "name: demo-skill", "description: Demo description", "---", "", "# Demo"].join("\n"),
        "utf8",
      );
      const skills = await listSkills(dir);
      expect(skills).toHaveLength(1);
      expect(skills[0]?.name).toBe("demo-skill");
      expect(skills[0]?.description).toBe("Demo description");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("readSkillInstructions strips frontmatter and returns body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-skills-body-"));
    try {
      const file = join(dir, "SKILL.md");
      writeFileSync(
        file,
        ["---", "name: demo-skill", "description: Demo description", "---", "", "# Demo", "Use this skill."].join("\n"),
        "utf8",
      );
      const body = await readSkillInstructions(file);
      expect(body).toBe("# Demo\nUse this skill.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
