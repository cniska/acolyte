import { resolveSubmitInput } from "./chat-submit";

type ProcessInputChangeParams = {
  currentValue: string;
  nextValue: string;
  applyingHistory: boolean;
  paste: boolean;
};

export type InputChangeDecision = {
  ignore: boolean;
  clearApplyingHistory: boolean;
  resetHistoryIndex: boolean;
  nextValue: string;
};

export function processInputChange(params: ProcessInputChangeParams): InputChangeDecision {
  // Swallow only a *typed* "?" on an empty field — it is the help shortcut the
  // keybinding layer consumes. A pasted "?" must insert as text (matching the
  // keybinding layer, which already ignores paste for the same shortcut).
  if (!params.paste && params.currentValue.length === 0 && params.nextValue === "?") {
    return {
      ignore: true,
      clearApplyingHistory: false,
      resetHistoryIndex: false,
      nextValue: params.currentValue,
    };
  }
  return {
    ignore: false,
    clearApplyingHistory: params.applyingHistory,
    resetHistoryIndex: !params.applyingHistory,
    nextValue: params.nextValue,
  };
}

type ProcessInputSubmitParams = {
  value: string;
  cursor?: number;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
};

export function processInputSubmit(params: ProcessInputSubmitParams) {
  return resolveSubmitInput({
    value: params.value,
    cursor: params.cursor,
    atSuggestions: params.atSuggestions,
    atSuggestionIndex: params.atSuggestionIndex,
    slashSuggestions: params.slashSuggestions,
    slashSuggestionIndex: params.slashSuggestionIndex,
  });
}
