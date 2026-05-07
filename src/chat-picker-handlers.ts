import { setModel } from "./app-config";
import { unreachable } from "./assert";
import type { ChatMessage } from "./chat-contract";
import { type ChatRow, createRow } from "./chat-contract";
import { summaryTitle } from "./chat-handoff";
import type { PickerState } from "./chat-picker";
import { createModelPicker, createPicker, createResumePicker } from "./chat-picker-actions";
import { setConfigValue } from "./config";
import { t } from "./i18n";
import { formatModel } from "./provider-config";
import type { Session, SessionState, SessionTokenUsageEntry } from "./session-contract";
import { createSession } from "./session-store";
import { createId } from "./short-id";
import { loadSkills } from "./skill-ops";

export type CreatePickerHandlersInput = {
  sessionState: SessionState;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  pendingHandoff: { summary: string; reason?: string } | null;
  setPendingHandoff: (next: { summary: string; reason?: string } | null) => void;
  setTokenUsage?: (updater: (current: SessionTokenUsageEntry[]) => SessionTokenUsageEntry[]) => void;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setRowsDirect: (next: ChatRow[]) => void;
  setPicker: (next: PickerState | null) => void;
  setShowHelp: (next: boolean | ((current: boolean) => boolean)) => void;
  setValue: (next: string) => void;
  persist: () => Promise<void>;
  toRows: (messages: ChatMessage[]) => ChatRow[];
  nowIso: () => string;
  persistConfig?: (key: string, value: string, scope: "project") => Promise<void>;
  activateSkill: (skillName: string, args: string) => Promise<boolean>;
  startAssistantTurn: (userText: string) => Promise<void>;
  clearTranscript: (sessionId?: string) => void;
};

export function createPickerHandlers(input: CreatePickerHandlersInput): {
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openModelPanel: () => Promise<void>;
  handlePickerSelect: (state: PickerState) => Promise<void>;
} {
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
    const nextPicker = createResumePicker(input.sessionState);
    if (!nextPicker) {
      input.setRows((current) => [...current, createRow("system", t("chat.picker.sessions.none"))]);
      return;
    }
    input.setPicker(nextPicker);
    input.setShowHelp(false);
  };

  const openModelPanel = async (): Promise<void> => {
    input.setPicker({
      kind: "model",
      items: [],
      filtered: [],
      query: "",
      index: 0,
      scrollOffset: 0,
      loading: true,
    });
    input.setShowHelp(false);
    try {
      const picker = await createModelPicker();
      input.setPicker(picker);
    } catch {
      input.setPicker(null);
    }
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
              createRow("system", t("chat.skill.failed", { skill: selected.name })),
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
          await writeConfig("model", nextModel, "project");
          setModel(nextModel);
          const nextSession: Session = { ...input.currentSession, model: nextModel, updatedAt: input.nowIso() };
          input.setCurrentSession(nextSession);
          await input.persist();
          input.setRows((current) => [
            ...current,
            createRow("system", t("chat.model.changed", { model: formatModel(nextModel) })),
          ]);
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
          input.sessionState.activeSessionId = selected.id;
          input.setCurrentSession(selected);
          input.setTokenUsage?.(() => selected.tokenUsage);
          input.clearTranscript(selected.id);
          input.setRowsDirect(input.toRows(selected.messages));
          await input.persist();
        }
        input.setPicker(null);
        return;
      }
      case "handoff": {
        const selected = state.items[state.index];
        if (!selected) return;
        if (selected.value === "cancel") {
          input.setPendingHandoff(null);
          input.setPicker(null);
          return;
        }
        const pending = input.pendingHandoff;
        if (!pending) {
          input.setPicker(null);
          return;
        }
        const now = input.nowIso();
        const next = createSession(input.currentSession.model);
        next.workspace = input.currentSession.workspace;
        next.workspaceName = input.currentSession.workspaceName;
        next.workspaceBranch = input.currentSession.workspaceBranch;
        if (input.currentSession.activeSkills) next.activeSkills = [...input.currentSession.activeSkills];
        const title = summaryTitle(pending.summary);
        if (title) next.title = title;
        next.messages = [
          {
            id: `msg_${createId()}`,
            role: "user",
            content: pending.summary,
            kind: "text",
            timestamp: now,
          },
        ];
        next.updatedAt = now;
        input.sessionState.sessions.unshift(next);
        input.sessionState.activeSessionId = next.id;
        input.setCurrentSession(next);
        input.setTokenUsage?.(() => []);
        input.clearTranscript(next.id);
        input.setRowsDirect(input.toRows(next.messages));
        input.setShowHelp(false);
        input.setValue("");
        input.setPendingHandoff(null);
        input.setPicker(null);
        await input.persist();
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
