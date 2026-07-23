import type { PickerState } from "./chat-picker";
import type { ViewportPickerInput, ViewportSuggestionsInput } from "./chat-viewport-contract";

export function createViewportPickerInput(
  picker: PickerState | null,
  activeSessionId: string | undefined,
): ViewportPickerInput | null {
  if (!picker) return null;
  switch (picker.kind) {
    case "model":
      return {
        kind: "model",
        input: picker.input,
        items: picker.filtered,
        selected: picker.index,
        scrollOffset: picker.scrollOffset,
        loading: picker.loading ?? false,
      };
    case "skills":
      return { kind: "skills", items: picker.items, selected: picker.index };
    case "resume":
      return {
        kind: "sessions",
        items: picker.items.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
        selected: picker.index,
        scrollOffset: picker.scrollOffset,
        activeSessionId: activeSessionId ?? null,
      };
  }
}

export function createViewportSuggestionsInput(input: {
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
}): ViewportSuggestionsInput {
  if (input.atQuery !== null)
    return { kind: "at", query: input.atQuery, candidates: input.atSuggestions, selected: input.atSuggestionIndex };
  if (input.slashSuggestions.length > 0)
    return { kind: "slash", candidates: input.slashSuggestions, selected: input.slashSuggestionIndex };
  return { kind: "none" };
}
