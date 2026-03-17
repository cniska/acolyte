import { appConfig } from "./app-config";
import type { ChatMessage } from "./chat-contract";
import type { ChatRow } from "./chat-contract";
import { compactText } from "./compact-text";
import type { Session } from "./session-contract";
import { findSkillByName, readSkillInstructions } from "./skills";

type CreateSkillActivatorInput = {
  currentSession: Session;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  createMessage: (role: ChatMessage["role"], content: string) => ChatMessage;
  nowIso: () => string;
  persist: () => Promise<void>;
};

export function createSkillActivator(
  input: CreateSkillActivatorInput,
): (skillName: string, args: string) => Promise<boolean> {
  return async (skillName, args) => {
    const skill = findSkillByName(skillName);
    if (!skill) return false;
    try {
      const instructions = await readSkillInstructions(skill.path, args || undefined);
      const compactedInstructions = compactText(instructions, appConfig.agent.skillBudget);
      const msg = input.createMessage("system", `Active skill (${skill.name}):\n${compactedInstructions}`);
      input.currentSession.messages.push(msg);
      input.currentSession.updatedAt = input.nowIso();
      await input.persist();
      return true;
    } catch {
      return false;
    }
  };
}
