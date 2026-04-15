import { type ChatRow, createRow } from "./chat-contract";
import type { Session } from "./session-contract";
import type { ActiveSkill } from "./skill-contract";
import { findSkillByName, readSkillInstructions } from "./skill-ops";
import { toolLabelKey } from "./tool-output-format";

export function addActiveSkill(target: { activeSkills?: ActiveSkill[] }, skill: ActiveSkill): void {
  const skills = target.activeSkills ?? [];
  target.activeSkills = [...skills.filter((s) => s.name !== skill.name), skill];
}

type CreateSkillActivatorInput = {
  currentSession: Session;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  nowIso: () => string;
  persist: () => Promise<void>;
};

export function skillActivationRow(skillName: string): ChatRow {
  return createRow("tool", {
    parts: [{ kind: "tool-header", labelKey: toolLabelKey("skill-activate"), detail: skillName }],
  });
}

export function createSkillActivator(
  input: CreateSkillActivatorInput,
): (skillName: string, args: string) => Promise<boolean> {
  return async (skillName, args) => {
    const skill = findSkillByName(skillName);
    if (!skill) return false;
    try {
      const instructions = await readSkillInstructions(skill.path, args || undefined);
      addActiveSkill(input.currentSession, { name: skill.name, instructions });
      input.currentSession.updatedAt = input.nowIso();
      input.setRows((current) => [...current, skillActivationRow(skill.name)]);
      await input.persist();
      return true;
    } catch {
      return false;
    }
  };
}
