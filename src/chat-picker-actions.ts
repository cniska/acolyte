import { appConfig } from "./app-config";
import type { ChatRow } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import type { PolicyCandidate } from "./policy-distill";
import type { Session, SessionStore } from "./types";

function row(role: ChatRow["role"], content: string): ChatRow {
  return { id: `row_${crypto.randomUUID()}`, role, content };
}

type PickerByKind = {
  skills: Extract<PickerState, { kind: "skills" }>;
  resume: Extract<PickerState, { kind: "resume" }>;
  permissions: Extract<PickerState, { kind: "permissions" }>;
  policy: Extract<PickerState, { kind: "policy" }>;
  policyConfirm: Extract<PickerState, { kind: "policyConfirm" }>;
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
  if (items.length === 0) {
    return null;
  }
  const activeIndex = items.findIndex((item) => item.id === store.activeSessionId);
  return createPicker({
    kind: "resume",
    items,
    index: activeIndex >= 0 ? activeIndex : 0,
  });
}

export function createResumeRows(session: Session, toRows: (messages: Session["messages"]) => ChatRow[]): ChatRow[] {
  return [...toRows(session.messages), row("assistant", `Resumed session: ${session.id.slice(0, 12)}`)];
}

export function createPermissionsPicker(): PickerState {
  const items: Array<{ mode: "read" | "write"; description: string }> = [
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

export function createPolicyPicker(items: PolicyCandidate[]): PickerState | null {
  if (items.length === 0) {
    return null;
  }
  return createPicker({
    kind: "policy",
    items,
    index: 0,
  });
}

export function createPolicyConfirmPicker(item: PolicyCandidate): PickerState {
  return {
    kind: "policyConfirm",
    item,
    items: [
      { value: "yes", description: "accept this draft" },
      { value: "no", description: "skip this draft" },
    ],
    index: 0,
    note: "",
  };
}

export function createWriteConfirmPicker(prompt: string): PickerState {
  return {
    kind: "writeConfirm",
    prompt,
    items: [
      { value: "switch", description: "switch to write mode" },
      { value: "cancel", description: "stay in read mode" },
    ],
    index: 0,
    note: "",
  };
}

export function boundedSkillInstructions(instructions: string, maxChars: number): string {
  if (instructions.length <= maxChars) {
    return instructions;
  }
  return `${instructions.slice(0, maxChars - 1)}…`;
}
