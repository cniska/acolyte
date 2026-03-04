import { z } from "zod";
import type { AgentMode } from "./agent-modes";
import { appConfig, setDefaultModel, setModeModel, setPermissionMode } from "./app-config";
import { unreachable } from "./assert";
import { type ChatRow, createRow, type TokenUsageEntry } from "./chat-commands";
import type { Message } from "./chat-message";
import type { PickerState } from "./chat-picker";
import {
  boundedSkillInstructions,
  createModelPicker,
  createPermissionsPicker,
  createPicker,
  createResumePicker,
  createResumeRows,
  createWriteConfirmPicker,
} from "./chat-picker-actions";
import { setConfigValue } from "./config";
import type { ConfigScope, PermissionMode } from "./config-contract";
import type { Session, SessionState } from "./session-contract";
import { findSkillByName, loadSkills, readSkillInstructions } from "./skills";

const MAX_SKILL_INSTRUCTION_CHARS = 4000;
const modelIdSchema = z.string().trim().min(1).regex(/^\S+$/);

type CreatePickerHandlersInput = {
  store: SessionState;
  currentSession: Session;
  setCurrentSession: (next: Session) => void;
  setTokenUsage?: (updater: (current: TokenUsageEntry[]) => TokenUsageEntry[]) => void;
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
  setRowsDirect: (next: ChatRow[]) => void;
  setPicker: (next: PickerState | null) => void;
  setShowHelp: (next: boolean | ((current: boolean) => boolean)) => void;
  setValue: (next: string) => void;
  queueInput: (next: string) => void;
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
  openModelPanel: (mode?: AgentMode) => void;
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
    input.setShowHelp(false);
  };

  const openResumePanel = (): void => {
    const nextPicker = createResumePicker(input.store);
    if (!nextPicker) {
      input.setRows((current) => [...current, createRow("system", "No saved sessions.")]);
      return;
    }
    input.setPicker(nextPicker);
    input.setShowHelp(false);
  };

  const openPermissionsPanel = (): void => {
    input.setPicker(createPermissionsPicker());
    input.setShowHelp(false);
  };

  const openModelPanel = (mode?: AgentMode): void => {
    const currentModel = mode ? (appConfig.models[mode] ?? input.currentSession.model) : input.currentSession.model;
    input.setPicker(createModelPicker(currentModel, mode));
    input.setShowHelp(false);
  };

  const openWriteConfirmPanel = (prompt: string): void => {
    input.setPicker(createWriteConfirmPicker(prompt));
    input.setShowHelp(false);
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
      case "model": {
        const custom = modelIdSchema.safeParse(state.customModel);
        const selected = state.items[state.index];
        const nextModel = selected?.model === "other" ? (custom.success ? custom.data : undefined) : selected?.model;
        if (!nextModel) return;
        try {
          if (state.targetMode) {
            await setConfigValue(`models.${state.targetMode}`, nextModel, { scope: "project" });
            setModeModel(state.targetMode, nextModel);
            input.setRows((current) => [
              ...current,
              createRow("system", `Changed ${state.targetMode} mode model to ${nextModel}.`),
            ]);
          } else {
            await setConfigValue("model", nextModel, { scope: "project" });
            setDefaultModel(nextModel);
            const nextSession: Session = { ...input.currentSession, model: nextModel, updatedAt: input.nowIso() };
            input.setCurrentSession(nextSession);
            input.setRows((current) => [...current, createRow("system", `Changed default model to ${nextModel}.`)]);
          }
        } catch (error) {
          input.setRows((current) => [
            ...current,
            createRow("system", error instanceof Error ? error.message : "Failed to set model."),
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
      default:
        return unreachable(state);
    }
  };

  return {
    openSkillsPanel,
    openResumePanel,
    openPermissionsPanel,
    openModelPanel,
    openWriteConfirmPanel,
    handlePickerSelect,
    activateSkill,
  };
}

export async function persistPermissionMode(mode: PermissionMode, scope: ConfigScope): Promise<void> {
  await setConfigValue("permissionMode", mode, { scope });
}
