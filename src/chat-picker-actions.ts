import type { AgentMode } from "./agent-modes";
import { type ChatRow, createRow } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import { t } from "./i18n";
import { getAvailableModels } from "./provider-models";
import type { Session, SessionState } from "./session-contract";

type PickerByKind = {
  skills: Extract<PickerState, { kind: "skills" }>;
  resume: Extract<PickerState, { kind: "resume" }>;
  model: Extract<PickerState, { kind: "model" }>;
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

export function createResumePicker(store: SessionState, limit = 20): PickerState | null {
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
    createRow("assistant", t("chat.resume.resumed", { sessionId: session.id }), { style: "sessionStatus" }),
  ];
}

export async function createModelPicker(currentModel: string, targetMode?: AgentMode): Promise<PickerState> {
  const models = await getAvailableModels(currentModel);
  const items = models.map((id) => ({ model: id, name: id, description: "" }));
  const index = items.findIndex((item) => item.model === currentModel);
  return {
    kind: "model",
    items,
    index: Math.max(0, index),
    targetMode,
  };
}
