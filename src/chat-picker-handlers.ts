import { appConfig, setPermissionMode } from "./app-config";
import type { ChatRow } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import {
  boundedSkillInstructions,
  createPermissionsPicker,
  createPicker,
  createResumePicker,
  createResumeRows,
} from "./chat-picker-actions";
import { listSkills, readSkillInstructions } from "./skills";
import type { Message, Session, SessionStore } from "./types";

const MAX_SKILL_INSTRUCTION_CHARS = 4000;

type CreatePickerHandlersInput = {
  store: SessionStore;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setRowsDirect: (next: ChatRow[]) => void;
  setPicker: (next: PickerState | null) => void;
  setShowShortcuts: (next: boolean | ((current: boolean) => boolean)) => void;
  persist: () => Promise<void>;
  toRows: (messages: Message[]) => ChatRow[];
  createMessage: (role: Message["role"], content: string) => Message;
  nowIso: () => string;
};

export function createPickerHandlers(input: CreatePickerHandlersInput): {
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openPermissionsPanel: () => void;
  handlePickerSelect: (state: PickerState) => Promise<void>;
} {
  const openSkillsPanel = async (): Promise<void> => {
    const skills = await listSkills();
    if (skills.length === 0) {
      input.setRows((current) => [
        ...current,
        { id: `row_${crypto.randomUUID()}`, role: "system", content: "No skills found in ./skills." },
      ]);
      return;
    }
    input.setPicker(
      createPicker({
        kind: "skills",
        items: skills,
        index: 0,
      }),
    );
    input.setShowShortcuts(false);
  };

  const openResumePanel = (): void => {
    const nextPicker = createResumePicker(input.store);
    if (!nextPicker) {
      input.setRows((current) => [
        ...current,
        { id: `row_${crypto.randomUUID()}`, role: "system", content: "No saved sessions." },
      ]);
      return;
    }
    input.setPicker(nextPicker);
    input.setShowShortcuts(false);
  };

  const openPermissionsPanel = (): void => {
    input.setPicker(createPermissionsPicker());
    input.setShowShortcuts(false);
  };

  const handlePickerSelect = async (state: PickerState): Promise<void> => {
    switch (state.kind) {
      case "skills": {
        const selected = state.items[state.index];
        if (selected) {
          try {
            const instructions = await readSkillInstructions(selected.path);
            const boundedInstructions = boundedSkillInstructions(instructions, MAX_SKILL_INSTRUCTION_CHARS);
            const msg = input.createMessage("system", `Active skill (${selected.name}):\n${boundedInstructions}`);
            input.currentSession.messages.push(msg);
            input.currentSession.updatedAt = input.nowIso();
            input.setRows((current) => [
              ...current,
              {
                id: `row_${crypto.randomUUID()}`,
                role: "system",
                content: `Activated skill: ${selected.name}`,
              },
            ]);
            await input.persist();
          } catch {
            input.setRows((current) => [
              ...current,
              {
                id: `row_${crypto.randomUUID()}`,
                role: "system",
                content: `Failed to activate skill: ${selected.name}`,
              },
            ]);
          }
        }
        input.setPicker(null);
        return;
      }
      case "permissions": {
        const selected = state.items[state.index];
        if (selected) {
          setPermissionMode(selected.mode);
          input.setRows((current) => [
            ...current,
            { id: `row_${crypto.randomUUID()}`, role: "assistant", content: `permission mode: ${selected.mode}` },
          ]);
        }
        input.setPicker(null);
        return;
      }
      case "resume": {
        const selected = state.items[state.index];
        if (selected) {
          input.store.activeSessionId = selected.id;
          input.setCurrentSession(selected);
          input.setRowsDirect(createResumeRows(selected, input.toRows));
          await input.persist();
        }
        input.setPicker(null);
        return;
      }
    }
  };

  return {
    openSkillsPanel,
    openResumePanel,
    openPermissionsPanel,
    handlePickerSelect,
  };
}
