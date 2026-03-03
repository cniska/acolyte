import { appConfig } from "./app-config";
import { type ChatRow, createRow } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import type { PermissionMode } from "./config-contract";
import { describeModel, providerFromModel, suggestedModelsForProvider } from "./provider-config";
import type { Session, SessionStore } from "./session-types";

type PickerByKind = {
  skills: Extract<PickerState, { kind: "skills" }>;
  resume: Extract<PickerState, { kind: "resume" }>;
  permissions: Extract<PickerState, { kind: "permissions" }>;
  model: Extract<PickerState, { kind: "model" }>;
  writeConfirm: Extract<PickerState, { kind: "writeConfirm" }>;
};

type CreatePickerConfig<K extends keyof PickerByKind> = {
  kind: K;
  items: PickerByKind[K]["items"];
  index: number;
};

export function createPicker<K extends keyof PickerByKind>(config: CreatePickerConfig<K>): PickerByKind[K] {
  return {
    kind: config.kind,
    items: config.items,
    index: config.index,
  } as PickerByKind[K];
}

export function createResumePicker(store: SessionStore, limit = 20): PickerState | null {
  const items = store.sessions.slice(0, limit);
  if (items.length === 0) return null;
  const activeIndex = items.findIndex((item) => item.id === store.activeSessionId);
  return createPicker({
    kind: "resume",
    items,
    index: activeIndex >= 0 ? activeIndex : 0,
  });
}

export function createResumeRows(session: Session, toRows: (messages: Session["messages"]) => ChatRow[]): ChatRow[] {
  return [
    ...toRows(session.messages),
    createRow("assistant", `Resumed session: ${session.id}`, { style: "sessionStatus" }),
  ];
}

export function createPermissionsPicker(): PickerState {
  const items: Array<{ mode: PermissionMode; description: string }> = [
    { mode: "read", description: "inspect/search only" },
    { mode: "write", description: "allow edits and shell commands" },
  ];
  const currentMode = appConfig.agent.permissions.mode;
  const index = items.findIndex((item) => item.mode === currentMode);
  return createPicker({
    kind: "permissions",
    items,
    index: index >= 0 ? index : 0,
  });
}

export function createModelPicker(currentModel: string): PickerState {
  const provider = providerFromModel(currentModel);
  const suggestions = suggestedModelsForProvider(provider);
  const items = [
    ...suggestions.map((model) => ({ model, description: describeModel(model) })),
    { model: "other", description: "" },
  ];
  const index = items.findIndex((item) => item.model === currentModel);
  return {
    kind: "model",
    items,
    index: index >= 0 ? index : items.length - 1,
    customModel: index < 0 ? currentModel : "",
  };
}

export function createWriteConfirmPicker(prompt: string): PickerState {
  return {
    kind: "writeConfirm",
    prompt,
    items: [
      { value: "switch", description: "enable write mode and continue this task" },
      { value: "cancel", description: "keep read mode" },
    ],
    index: 0,
    note: "",
  };
}

export function boundedSkillInstructions(instructions: string, maxChars: number): string {
  if (instructions.length <= maxChars) return instructions;
  return `${instructions.slice(0, maxChars - 1)}…`;
}
