import type { AgentMode } from "./agent-contract";
import { appConfig, setDefaultModel, setModeModel } from "./app-config";
import { unreachable } from "./assert";
import { type ChatRow, createRow } from "./chat-commands";
import type { Message } from "./chat-message-contract";
import type { PickerState } from "./chat-picker";
import { createModelPicker, createPicker, createResumePicker, createResumeRows } from "./chat-picker-actions";
import { compactText } from "./compact-text";
import { setConfigValue } from "./config";
import { t } from "./i18n";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { findSkillByName, loadSkills, readSkillInstructions } from "./skills";

type CreatePickerHandlersInput = {
  store: SessionState;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setTokenUsage?: (updater: (current: SessionTokenUsageEntry[]) => SessionTokenUsageEntry[]) => void;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setRowsDirect: (next: ChatRow[]) => void;
  setPicker: (next: PickerState | null) => void;
  setShowHelp: (next: boolean | ((current: boolean) => boolean)) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  toRows: (messages: Message[]) => ChatRow[];
  createMessage: (role: Message["role"], content: string) => Message;
  nowIso: () => string;
};

export function createPickerHandlers(input: CreatePickerHandlersInput): {
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openModelPanel: (mode?: AgentMode) => Promise<void>;
  handlePickerSelect: (state: PickerState) => Promise<void>;
  activateSkill: (skillName: string, args: string) => Promise<boolean>;
} {
  const activateSkill = async (skillName: string, args: string): Promise<boolean> => {
    const skill = findSkillByName(skillName);
    if (!skill) return false;
    try {
      const instructions = await readSkillInstructions(skill.path, args || undefined);
      const compactedInstructions = compactText(instructions, appConfig.agent.skillBudget);
      const msg = input.createMessage("system", `Active skill (${skill.name}):\n${compactedInstructions}`);
      input.currentSession.messages.push(msg);
      input.currentSession.updatedAt = input.nowIso();
      const label = args
        ? t("chat.skill.activated.with_args", { skill: skill.name })
        : t("chat.skill.activated", { skill: skill.name });
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
      input.setRows((current) => [...current, createRow("system", t("chat.picker.skills.none"))]);
      return;
    }
    input.setPicker(
      createPicker({
        kind: "skills",
        items: skills,
        index: 0,
      }),
    );
    input.setShowHelp(false);
  };

  const openResumePanel = (): void => {
    const nextPicker = createResumePicker(input.store);
    if (!nextPicker) {
      input.setRows((current) => [...current, createRow("system", t("chat.picker.sessions.none"))]);
      return;
    }
    input.setPicker(nextPicker);
    input.setShowHelp(false);
  };

  const openModelPanel = async (mode?: AgentMode): Promise<void> => {
    input.setPicker({
      kind: "model",
      items: [],
      filtered: [],
      query: "",
      index: 0,
      scrollOffset: 0,
      targetMode: mode,
      loading: true,
    });
    input.setShowHelp(false);
    const picker = await createModelPicker(mode);
    input.setPicker(picker);
  };

  const handlePickerSelect = async (state: PickerState): Promise<void> => {
    switch (state.kind) {
      case "skills": {
        const selected = state.items[state.index];
        if (selected) {
          const ok = await activateSkill(selected.name, "");
          if (!ok) {
            input.setRows((current) => [
              ...current,
              createRow("system", t("chat.skill.failed", { skill: selected.name })),
            ]);
          }
        }
        input.setPicker(null);
        return;
      }
      case "model": {
        const nextModel = state.filtered[state.index];
        if (!nextModel) return;
        try {
          const targetMode = state.targetMode;
          if (targetMode) {
            await setConfigValue(`models.${targetMode}`, nextModel, { scope: "project" });
            setModeModel(targetMode, nextModel);
            input.setRows((current) => [
              ...current,
              createRow("system", t("chat.model.changed.mode", { mode: targetMode, model: formatModel(nextModel) })),
            ]);
          } else {
            await setConfigValue("model", nextModel, { scope: "project" });
            setDefaultModel(nextModel);
            const nextSession: Session = { ...input.currentSession, model: nextModel, updatedAt: input.nowIso() };
            input.setCurrentSession(nextSession);
            input.setRows((current) => [
              ...current,
              createRow("system", t("chat.model.changed.default", { model: formatModel(nextModel) })),
            ]);
          }
        } catch (error) {
          input.setRows((current) => [
            ...current,
            createRow("system", error instanceof Error ? error.message : t("chat.model.failed")),
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
          input.setTokenUsage?.(() => selected.tokenUsage);
          input.setRowsDirect(createResumeRows(selected, input.toRows));
          await input.persist();
        }
        input.setPicker(null);
        return;
      }
      default:
        return unreachable(state);
    }
  };

  return {
    openSkillsPanel,
    openResumePanel,
    openModelPanel,
    handlePickerSelect,
    activateSkill,
  };
}
