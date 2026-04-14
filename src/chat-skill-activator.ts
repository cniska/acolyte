import type { ChatRow } from "./chat-contract";
import { type CompactBudget, compactText } from "./compact-text";
import type { Session } from "./session-contract";
import { findSkillByName, readSkillInstructions, SKILL_BUDGET } from "./skills";
import { toolLabelKey } from "./tool-output-format";

type CreateSkillActivatorDeps = {
  skillBudget?: CompactBudget;
};

type CreateSkillActivatorInput = {
  currentSession: Session;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  nowIso: () => string;
  persist: () => Promise<void>;
};

export function skillActivationRow(skillName: string): ChatRow {
  return {
    id: `row_skill_${Date.now()}`,
    kind: "tool",
    content: {
      parts: [{ kind: "tool-header", labelKey: toolLabelKey("skill-activate"), detail: skillName }],
    },
  };
}

export function createSkillActivator(
  deps: CreateSkillActivatorDeps,
  input: CreateSkillActivatorInput,
): (skillName: string, args: string) => Promise<boolean> {
  const skillBudget = deps.skillBudget ?? SKILL_BUDGET;
  return async (skillName, args) => {
    const skill = findSkillByName(skillName);
    if (!skill) return false;
    try {
      const instructions = await readSkillInstructions(skill.path, args || undefined);
      const compactedInstructions = compactText(instructions, skillBudget);
      input.currentSession.activeSkill = { name: skill.name, instructions: compactedInstructions };
      input.currentSession.updatedAt = input.nowIso();
      input.setRows((current) => [...current, skillActivationRow(skill.name)]);
      await input.persist();
      return true;
    } catch {
      return false;
    }
  };
}
