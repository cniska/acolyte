import type { AgentMode } from "./agent-modes";
import { appConfig } from "./app-config";
import { type ChatRow, createRow } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import { t } from "./i18n";
import { providerFromModel, suggestedModelsForProvider } from "./provider-config";
import type { Provider } from "./provider-contract";
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

export function createModelPicker(currentModel: string, targetMode?: AgentMode): PickerState {
  const providers: Provider[] = [];
  if (appConfig.openai.apiKey) providers.push("openai");
  if (appConfig.anthropic.apiKey) providers.push("anthropic");
  if (appConfig.google.apiKey) providers.push("gemini");
  const fallbackProvider = providerFromModel(currentModel);
  if (!providers.includes(fallbackProvider)) providers.push(fallbackProvider);
  const seen = new Set<string>();
  const suggestions = providers.flatMap((provider) =>
    suggestedModelsForProvider(provider).filter((m) => !seen.has(m.id) && seen.add(m.id)),
  );
  const items = suggestions.map((m) => ({ model: m.id, name: m.name, description: m.description }));
  const index = items.findIndex((item) => item.model === currentModel);
  return {
    kind: "model",
    items,
    index: Math.max(0, index),
    targetMode,
  };
}
