import type { AgentMode } from "./agent-contract";
import { type ModelPickerItem, PICKER_PAGE_SIZE, type PickerState } from "./chat-picker";
import { getAvailableModels } from "./provider-models";
import type { SessionState } from "./session-contract";

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

export function createResumePicker(store: SessionState): PickerState | null {
  const items = store.sessions;
  if (items.length === 0) return null;
  const activeIndex = items.findIndex((item) => item.id === store.activeSessionId);
  const index = activeIndex >= 0 ? activeIndex : 0;
  const scrollOffset = Math.max(0, index - PICKER_PAGE_SIZE + 1);
  return { kind: "resume", items, index, scrollOffset };
}

function modelPickerItem(id: string): ModelPickerItem {
  const prefix = "openai-compatible/";
  if (id.startsWith(prefix)) return { label: id.slice(prefix.length), value: id };
  return { label: id, value: id };
}

export async function createModelPicker(targetMode?: AgentMode): Promise<PickerState> {
  const items = (await getAvailableModels()).map(modelPickerItem);
  return {
    kind: "model",
    items,
    filtered: items,
    query: "",
    index: 0,
    scrollOffset: 0,
    targetMode,
  };
}
