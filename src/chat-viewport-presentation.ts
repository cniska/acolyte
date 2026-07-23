import { BREAKPOINT_TWO_COLUMN } from "./chat-layout";
import { slashCommandHelp } from "./chat-slash";
import type {
  ChatViewportPresentation,
  ChatViewportPresentationInput,
  ComposerPresentationContract,
  ViewportPickerInput,
} from "./chat-viewport-contract";
import { t } from "./i18n";

function presentPicker(picker: ViewportPickerInput | null): ComposerPresentationContract["picker"] {
  if (!picker) return null;
  switch (picker.kind) {
    case "model":
      return {
        kind: "model",
        input: picker.input,
        items: picker.items,
        selected: picker.selected,
        scrollOffset: picker.scrollOffset,
        hint: t("chat.picker.hint.model"),
        loading: picker.loading,
      };
    case "skills":
      return {
        kind: "skills",
        items: picker.items.map((item) => ({
          label: item.name,
          value: item.path,
          detail: item.description,
          source: item.source,
        })),
        selected: picker.selected,
        scrollOffset: 0,
        hint: t("chat.picker.hint.skills"),
      };
    case "sessions":
      return {
        kind: "sessions",
        items: picker.items.map((item) => ({
          label: item.title,
          value: item.id,
          detail: item.updatedAt,
          active: item.id === picker.activeSessionId,
        })),
        selected: picker.selected,
        scrollOffset: picker.scrollOffset,
        hint: t("chat.picker.hint.resume"),
      };
  }
}

export function createChatViewportPresentation(input: ChatViewportPresentationInput): ChatViewportPresentation {
  const picker = presentPicker(input.composer.picker);
  const suggestions =
    input.composer.suggestions.kind === "at"
      ? {
          kind: "at" as const,
          query: input.composer.suggestions.query,
          candidates: input.composer.suggestions.candidates.map((value) => ({ label: value, value })),
          selected: input.composer.suggestions.selected,
          noMatches: input.composer.suggestions.candidates.length === 0,
        }
      : input.composer.suggestions.kind === "slash"
        ? {
            kind: "slash" as const,
            candidates: input.composer.suggestions.candidates.map((command) => ({
              command,
              help: slashCommandHelp(command),
            })),
            selected: input.composer.suggestions.selected,
          }
        : { kind: "none" as const };
  return {
    header: input.header,
    transcript: input.activeTranscript,
    pending: input.pending,
    composer: {
      input: input.composer.input,
      placeholder: t("chat.input.placeholder"),
      focus: true,
      caretVisible: true,
      revision: 0,
      ctrlCPending: input.composer.ctrlCPending,
      prompt: picker ? "picker" : "chat",
      cursorLine: 0,
      activeIdentity: input.composer.picker?.kind === "sessions" ? input.composer.picker.activeSessionId : null,
      picker,
      suggestions,
      showHelp: input.composer.help.visible,
      helpEntries: [...input.composer.help.entries],
      helpBreakpoint: BREAKPOINT_TWO_COLUMN,
    },
    footer: input.composer.footer,
    sections: [],
  };
}
