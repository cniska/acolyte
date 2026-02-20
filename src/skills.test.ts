import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { listSkills } from "./skills";

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
        [
          "---",
          "name: demo-skill",
          "description: Demo description",
          "---",
          "",
          "# Demo",
        ].join("\n"),
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
});

