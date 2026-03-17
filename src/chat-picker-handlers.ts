import type { AgentMode } from "./agent-contract";
import { setDefaultModel, setModeModel } from "./app-config";
import { unreachable } from "./assert";
import type { ChatMessage } from "./chat-contract";
import { type ChatEntry, createLine } from "./chat-contract";
import type { PickerState } from "./chat-picker";
import { createModelPicker, createPicker, createResumePicker } from "./chat-picker-actions";
import { setConfigValue } from "./config";
import { t } from "./i18n";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { loadSkills } from "./skills";

export type CreatePickerHandlersInput = {
  store: SessionState;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setTokenUsage?: (updater: (current: SessionTokenUsageEntry[]) => SessionTokenUsageEntry[]) => void;
  setRows: (updater: (current: ChatEntry[]) => ChatEntry[]) => void;
  setRowsDirect: (next: ChatEntry[]) => void;
  setPicker: (next: PickerState | null) => void;
  setShowHelp: (next: boolean | ((current: boolean) => boolean)) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  toRows: (messages: ChatMessage[]) => ChatEntry[];
  nowIso: () => string;
  persistConfig?: (key: string, value: string, scope: "project") => Promise<void>;
  activateSkill: (skillName: string, args: string) => Promise<boolean>;
  startAssistantTurn: (userText: string) => Promise<void>;
  clearTranscript: (sessionId?: string) => void;
};

export function createPickerHandlers(input: CreatePickerHandlersInput): {
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openModelPanel: (mode?: AgentMode) => Promise<void>;
  handlePickerSelect: (state: PickerState) => Promise<void>;
} {
  const openSkillsPanel = async (): Promise<void> => {
    const skills = await loadSkills();
    if (skills.length === 0) {
      input.setRows((current) => [...current, createLine("system", t("chat.picker.skills.none"))]);
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
      input.setRows((current) => [...current, createLine("system", t("chat.picker.sessions.none"))]);
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

  const writeConfig = input.persistConfig ?? ((key, value, scope) => setConfigValue(key, value, { scope }));

  const handlePickerSelect = async (state: PickerState): Promise<void> => {
    switch (state.kind) {
      case "skills": {
        const selected = state.items[state.index];
        if (selected) {
          const ok = await input.activateSkill(selected.name, "");
          if (!ok) {
            input.setRows((current) => [
              ...current,
              createLine("system", t("chat.skill.failed", { skill: selected.name })),
            ]);
          } else {
            input.setPicker(null);
            const runPrompt = t("chat.skill.run_prompt", { skill: selected.name });
            void input.startAssistantTurn(runPrompt);
            return;
          }
        }
        input.setPicker(null);
        return;
      }
      case "model": {
        const nextModel = state.filtered[state.index]?.value;
        if (!nextModel) return;
        try {
          const targetMode = state.targetMode;
          if (targetMode) {
            await writeConfig(`models.${targetMode}`, nextModel, "project");
            setModeModel(targetMode, nextModel);
            input.setRows((current) => [
              ...current,
              createLine("system", t("chat.model.changed.mode", { mode: targetMode, model: formatModel(nextModel) })),
            ]);
          } else {
            await writeConfig("model", nextModel, "project");
            setDefaultModel(nextModel);
            const nextSession: Session = { ...input.currentSession, model: nextModel, updatedAt: input.nowIso() };
            input.setCurrentSession(nextSession);
            input.setRows((current) => [
              ...current,
              createLine("system", t("chat.model.changed.default", { model: formatModel(nextModel) })),
            ]);
          }
        } catch (error) {
          input.setRows((current) => [
            ...current,
            createLine("system", error instanceof Error ? error.message : t("chat.model.failed")),
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
          input.clearTranscript(selected.id);
          input.setRowsDirect(input.toRows(selected.messages));
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
  };
}
