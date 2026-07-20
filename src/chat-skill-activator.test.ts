import { describe, expect, test } from "bun:test";
import { isToolOutput } from "./chat-contract";
import { addActiveSkill, removeActiveSkill, skillActivationRow } from "./chat-skill-activator";
import type { ActiveSkill } from "./skill-contract";

describe("skillActivationRow", () => {
  test("creates a tool row with skill header", () => {
    const row = skillActivationRow("build");
    expect(row.kind).toBe("tool");
    expect(row.id).toMatch(/^row_/);
    expect(isToolOutput(row.content)).toBe(true);
    if (isToolOutput(row.content)) {
      expect(row.content.parts).toHaveLength(1);
      expect(row.content.parts[0]).toMatchObject({
        kind: "tool-header",
        detail: "build",
      });
    }
  });
});

describe("addActiveSkill", () => {
  test("adds a skill to an empty list", () => {
    const target: { activeSkills?: ActiveSkill[] } = {};
    addActiveSkill(target, { name: "build", instructions: "slice it" });
    expect(target.activeSkills).toEqual([{ name: "build", instructions: "slice it" }]);
  });

  test("replaces a skill with the same name", () => {
    const target: { activeSkills?: ActiveSkill[] } = {
      activeSkills: [{ name: "build", instructions: "old" }],
    };
    addActiveSkill(target, { name: "build", instructions: "new" });
    expect(target.activeSkills).toEqual([{ name: "build", instructions: "new" }]);
  });

  test("appends a different skill without removing existing", () => {
    const target: { activeSkills?: ActiveSkill[] } = {
      activeSkills: [{ name: "build", instructions: "slice it" }],
    };
    addActiveSkill(target, { name: "git", instructions: "commit often" });
    expect(target.activeSkills).toEqual([
      { name: "build", instructions: "slice it" },
      { name: "git", instructions: "commit often" },
    ]);
  });
});

describe("removeActiveSkill", () => {
  test("removes the named skill and preserves the others", () => {
    const target: { activeSkills?: ActiveSkill[] } = {
      activeSkills: [
        { name: "build", instructions: "slice it" },
        { name: "git", instructions: "commit often" },
      ],
    };
    removeActiveSkill(target, "build");
    expect(target.activeSkills).toEqual([{ name: "git", instructions: "commit often" }]);
  });

  test("yields an empty array rather than undefined when the last skill is removed", () => {
    const target: { activeSkills?: ActiveSkill[] } = {
      activeSkills: [{ name: "build", instructions: "slice it" }],
    };
    removeActiveSkill(target, "build");
    expect(target.activeSkills).toEqual([]);
  });

  test("is a no-op when the name is not active", () => {
    const target: { activeSkills?: ActiveSkill[] } = {
      activeSkills: [{ name: "build", instructions: "slice it" }],
    };
    removeActiveSkill(target, "git");
    expect(target.activeSkills).toEqual([{ name: "build", instructions: "slice it" }]);
  });
});
