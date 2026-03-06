import type { AgentMode } from "./agent-modes";
import { appConfig } from "./app-config";
import { type ChatRow, createRow } from "./chat-commands";
import type { PickerState } from "./chat-picker";
import type { PermissionMode } from "./config-contract";
import { t } from "./i18n";
import { providerFromModel, suggestedModelsForProvider } from "./provider-config";
import type { Provider } from "./provider-contract";
import type { Session, SessionState } from "./session-contract";

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
  const items = [
    ...suggestions.map((m) => ({ model: m.id, name: m.name, description: m.description })),
    { model: "other", name: "other", description: "" },
  ];
  const index = items.findIndex((item) => item.model === currentModel);
  return {
    kind: "model",
    items,
    index: index >= 0 ? index : items.length - 1,
    customModel: index < 0 ? currentModel : "",
    targetMode,
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
