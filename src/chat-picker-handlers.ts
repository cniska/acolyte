import { setPermissionMode } from "./app-config";
import { type ChatRow, createRow, type TokenUsageEntry } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import {
  boundedSkillInstructions,
  createClarifyAnswerPicker,
  createPermissionsPicker,
  createPicker,
  createResumePicker,
  createResumeRows,
  createWriteConfirmPicker,
} from "./chat-picker-actions";
import { setConfigValue } from "./config";
import type { ConfigScope, PermissionMode } from "./config-modes";
import { findSkillByName, loadSkills, readSkillInstructions } from "./skills";
import type { Message, Session, SessionStore } from "./types";

const MAX_SKILL_INSTRUCTION_CHARS = 4000;

type CreatePickerHandlersInput = {
  store: SessionStore;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setTokenUsage?: (updater: (current: TokenUsageEntry[]) => TokenUsageEntry[]) => void;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setRowsDirect: (next: ChatRow[]) => void;
  setPicker: (next: PickerState | null) => void;
  setShowShortcuts: (next: boolean | ((current: boolean) => boolean)) => void;
  setValue: (next: string) => void;
  queueInput: (next: string) => void;
  buildClarificationPayload: (input: {
    originalPrompt: string;
    answers: Array<{ question: string; answer: string }>;
  }) => string;
  buildWriteResumePayload: (prompt: string) => string;
  setServerPermissionMode: (mode: PermissionMode) => Promise<void>;
  persistPermissionMode: (mode: PermissionMode, scope: ConfigScope) => Promise<void>;
  persist: () => Promise<void>;
  toRows: (messages: Message[]) => ChatRow[];
  createMessage: (role: Message["role"], content: string) => Message;
  nowIso: () => string;
};

export function createPickerHandlers(input: CreatePickerHandlersInput): {
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openPermissionsPanel: () => void;
  openClarifyPanel: (questions: string[], originalPrompt: string) => void;
  openWriteConfirmPanel: (prompt: string) => void;
  handlePickerSelect: (state: PickerState) => Promise<void>;
  activateSkill: (skillName: string, args: string) => Promise<boolean>;
} {
  const activateSkill = async (skillName: string, args: string): Promise<boolean> => {
    const skill = findSkillByName(skillName);
    if (!skill) return false;
    try {
      const instructions = await readSkillInstructions(skill.path, args || undefined);
      const bounded = boundedSkillInstructions(instructions, MAX_SKILL_INSTRUCTION_CHARS);
      const msg = input.createMessage("system", `Active skill (${skill.name}):\n${bounded}`);
      input.currentSession.messages.push(msg);
      input.currentSession.updatedAt = input.nowIso();
      const label = args ? `Activated skill: ${skill.name} (with arguments)` : `Activated skill: ${skill.name}`;
      input.setRows((current) => [...current, createRow("system", label)]);
      await input.persist();
      return true;
    } catch {
      return false;
    }
  };

  const openSkillsPanel = async (): Promise<void> => {
    const skills = await loadSkills();
    if (skills.length === 0) {
      input.setRows((current) => [...current, createRow("system", "No skills found in ./skills or ./.agents/skills.")]);
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
      input.setRows((current) => [...current, createRow("system", "No saved sessions.")]);
      return;
    }
    input.setPicker(nextPicker);
    input.setShowShortcuts(false);
  };

  const openPermissionsPanel = (): void => {
    input.setPicker(createPermissionsPicker());
    input.setShowShortcuts(false);
  };

  const openClarifyPanel = (questions: string[], originalPrompt: string): void => {
    const [first, ...remaining] = questions
      .map((question) => question.trim())
      .filter((question) => question.length > 0);
    if (!first) return;
    const picker = createClarifyAnswerPicker(originalPrompt, first, remaining);
    if (!picker) return;
    input.setPicker(picker);
    input.setShowShortcuts(false);
  };

  const openWriteConfirmPanel = (prompt: string): void => {
    input.setPicker(createWriteConfirmPicker(prompt));
    input.setShowShortcuts(false);
  };

  const handlePickerSelect = async (state: PickerState): Promise<void> => {
    switch (state.kind) {
      case "skills": {
        const selected = state.items[state.index];
        if (selected) {
          try {
            const instructions = await readSkillInstructions(selected.path, "");
            const boundedInstructions = boundedSkillInstructions(instructions, MAX_SKILL_INSTRUCTION_CHARS);
            const msg = input.createMessage("system", `Active skill (${selected.name}):\n${boundedInstructions}`);
            input.currentSession.messages.push(msg);
            input.currentSession.updatedAt = input.nowIso();
            input.setRows((current) => [...current, createRow("system", `Activated skill: ${selected.name}`)]);
            await input.persist();
          } catch {
            input.setRows((current) => [...current, createRow("system", `Failed to activate skill: ${selected.name}`)]);
          }
        }
        input.setPicker(null);
        return;
      }
      case "permissions": {
        const selected = state.items[state.index];
        if (selected) {
          try {
            await input.setServerPermissionMode(selected.mode);
            await input.persistPermissionMode(selected.mode, "project");
            setPermissionMode(selected.mode);
            input.setRows((current) => [
              ...current,
              createRow("system", `Changed permissions to ${selected.mode} (project).`),
            ]);
          } catch (error) {
            input.setRows((current) => [
              ...current,
              createRow("system", error instanceof Error ? error.message : "Failed to set permission mode."),
            ]);
          }
        }
        input.setPicker(null);
        return;
      }
      case "resume": {
        const selected = state.items[state.index];
        if (selected) {
          input.store.activeSessionId = selected.id;
          input.setCurrentSession(selected);
          input.setTokenUsage?.(() => selected.tokenUsage);
          input.setRowsDirect(createResumeRows(selected, input.toRows));
          await input.persist();
        }
        input.setPicker(null);
        return;
      }
      case "clarifyAnswer": {
        const answer = state.note.trim();
        if (answer.length === 0) {
          input.setRows((current) => [...current, createRow("system", "Please enter an answer before continuing.")]);
          return;
        }
        const answers = [...state.answers, { question: state.question, answer }];
        const [nextQuestion, ...remaining] = state.remaining;
        if (nextQuestion) {
          input.setPicker(createClarifyAnswerPicker(state.originalPrompt, nextQuestion, remaining, answers));
          return;
        }
        input.queueInput(
          input.buildClarificationPayload({
            originalPrompt: state.originalPrompt,
            answers,
          }),
        );
        input.setRows((current) => [
          ...current,
          createRow(
            "assistant",
            `Captured ${answers.length} clarification${answers.length === 1 ? "" : "s"}. Continuing…`,
            { dim: true },
          ),
        ]);
        input.setPicker(null);
        return;
      }
      case "writeConfirm": {
        const selected = state.items[state.index];
        if (selected.value === "switch") {
          try {
            await input.setServerPermissionMode("write");
            await input.persistPermissionMode("write", "project");
            setPermissionMode("write");
            input.setRows((current) => [...current, createRow("system", "Switched to write mode.")]);
            input.setValue("");
            input.queueInput(input.buildWriteResumePayload(state.prompt));
          } catch (error) {
            input.setRows((current) => [
              ...current,
              createRow("system", error instanceof Error ? error.message : "Failed to switch permission mode."),
            ]);
          }
        } else {
          input.setRows((current) => [...current, createRow("system", "Staying in read mode.")]);
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
    openClarifyPanel,
    openWriteConfirmPanel,
    handlePickerSelect,
    activateSkill,
  };
}

export async function persistPermissionMode(mode: PermissionMode, scope: ConfigScope): Promise<void> {
  await setConfigValue("permissionMode", mode, { scope });
}
