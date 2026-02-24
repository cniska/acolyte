import { setPermissionMode } from "./app-config";
import type { ChatRow, TokenUsageEntry } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import {
  boundedSkillInstructions,
  createClarifyAnswerPicker,
  createPermissionsPicker,
  createPicker,
  createPolicyConfirmPicker,
  createPolicyPicker,
  createResumePicker,
  createResumeRows,
  createWriteConfirmPicker,
} from "./chat-picker-actions";
import { setConfigValue } from "./config";
import type { PolicyCandidate } from "./policy-distill";
import { listSkills, readSkillInstructions } from "./skills";
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
  setPendingPolicyCandidate: (next: PolicyCandidate | null) => void;
  setValue: (next: string) => void;
  queueInput: (next: string) => void;
  buildClarificationPayload: (input: {
    originalPrompt: string;
    answers: Array<{ question: string; answer: string }>;
  }) => string;
  buildWriteResumePayload: (prompt: string) => string;
  setBackendPermissionMode: (mode: "read" | "write") => Promise<void>;
  persistPermissionMode: (mode: "read" | "write", scope: "project" | "user") => Promise<void>;
  persist: () => Promise<void>;
  toRows: (messages: Message[]) => ChatRow[];
  createMessage: (role: Message["role"], content: string) => Message;
  nowIso: () => string;
};

export function createPickerHandlers(input: CreatePickerHandlersInput): {
  openSkillsPanel: () => Promise<void>;
  openResumePanel: () => void;
  openPermissionsPanel: () => void;
  openPolicyPanel: (items: PolicyCandidate[]) => void;
  openClarifyPanel: (questions: string[], originalPrompt: string) => void;
  openWriteConfirmPanel: (prompt: string) => void;
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

  const openPolicyPanel = (items: PolicyCandidate[]): void => {
    const picker = createPolicyPicker(items);
    if (!picker) {
      input.setRows((current) => [
        ...current,
        { id: `row_${crypto.randomUUID()}`, role: "system", content: "No repeated policy signals found." },
      ]);
      return;
    }
    if (items.length === 1) {
      const selected = items[0];
      input.setPendingPolicyCandidate(selected);
      input.setPicker(createPolicyConfirmPicker(selected));
      input.setShowShortcuts(false);
      return;
    }
    input.setPicker(picker);
    input.setShowShortcuts(false);
  };

  const openClarifyPanel = (questions: string[], originalPrompt: string): void => {
    const [first, ...remaining] = questions
      .map((question) => question.trim())
      .filter((question) => question.length > 0);
    if (!first) {
      return;
    }
    const picker = createClarifyAnswerPicker(originalPrompt, first, remaining);
    if (!picker) {
      return;
    }
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
          try {
            await input.setBackendPermissionMode(selected.mode);
            await input.persistPermissionMode(selected.mode, "project");
            setPermissionMode(selected.mode);
            input.setRows((current) => [
              ...current,
              {
                id: `row_${crypto.randomUUID()}`,
                role: "system",
                content: `Changed permissions to ${selected.mode} (project).`,
              },
            ]);
          } catch (error) {
            input.setRows((current) => [
              ...current,
              {
                id: `row_${crypto.randomUUID()}`,
                role: "system",
                content: error instanceof Error ? error.message : "Failed to set permission mode.",
              },
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
      case "policy": {
        const selected = state.items[state.index];
        if (selected) {
          input.setPendingPolicyCandidate(selected);
          input.setPicker(createPolicyConfirmPicker(selected));
          return;
        }
        input.setPicker(null);
        return;
      }
      case "policyConfirm": {
        const selected = state.items[state.index];
        const note = state.note.trim();
        const noteSuffix = note ? ` | note: ${note}` : "";
        if (selected.value === "yes") {
          input.setRows((current) => [
            ...current,
            {
              id: `row_${crypto.randomUUID()}`,
              role: "assistant",
              content: `Policy draft confirmed: ${state.item.normalized}${noteSuffix}`,
            },
          ]);
        } else {
          input.setRows((current) => [
            ...current,
            {
              id: `row_${crypto.randomUUID()}`,
              role: "assistant",
              content: `Policy draft skipped.${noteSuffix}`,
            },
          ]);
        }
        input.setPendingPolicyCandidate(null);
        input.setPicker(null);
        return;
      }
      case "clarifyAnswer": {
        const answer = state.note.trim();
        if (answer.length === 0) {
          input.setRows((current) => [
            ...current,
            {
              id: `row_${crypto.randomUUID()}`,
              role: "system",
              content: "Please enter an answer before continuing.",
            },
          ]);
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
          {
            id: `row_${crypto.randomUUID()}`,
            role: "assistant",
            content: `Captured ${answers.length} clarification${answers.length === 1 ? "" : "s"}. Continuing…`,
            dim: true,
          },
        ]);
        input.setPicker(null);
        return;
      }
      case "writeConfirm": {
        const selected = state.items[state.index];
        const note = state.note.trim();
        const noteSuffix = note ? ` | reason: ${note}` : "";
        if (selected.value === "switch") {
          try {
            await input.setBackendPermissionMode("write");
            await input.persistPermissionMode("write", "project");
            setPermissionMode("write");
            input.setRows((current) => [
              ...current,
              {
                id: `row_${crypto.randomUUID()}`,
                role: "assistant",
                content: `Changed permissions to write${noteSuffix}`,
              },
            ]);
            input.setValue("");
            input.queueInput(input.buildWriteResumePayload(state.prompt));
          } catch (error) {
            input.setRows((current) => [
              ...current,
              {
                id: `row_${crypto.randomUUID()}`,
                role: "system",
                content: error instanceof Error ? error.message : "Failed to switch permission mode.",
              },
            ]);
          }
        } else {
          input.setRows((current) => [
            ...current,
            {
              id: `row_${crypto.randomUUID()}`,
              role: "assistant",
              content: `Staying in read mode.${noteSuffix}\nI can still help with a read-only plan for this change.`,
            },
          ]);
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
    openPolicyPanel,
    openClarifyPanel,
    openWriteConfirmPanel,
    handlePickerSelect,
  };
}

export async function persistPermissionMode(mode: "read" | "write", scope: "project" | "user"): Promise<void> {
  await setConfigValue("permissionMode", mode, { scope });
}
