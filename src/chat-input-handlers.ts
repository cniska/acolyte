import { resolveSubmitInput } from "./chat-submit";

type ProcessInputChangeParams = {
  currentValue: string;
  nextValue: string;
  applyingHistory: boolean;
};

export type InputChangeDecision = {
  ignore: boolean;
  clearApplyingHistory: boolean;
  resetHistoryIndex: boolean;
  nextValue: string;
};

export function processInputChange(params: ProcessInputChangeParams): InputChangeDecision {
  if (params.currentValue.length === 0 && params.nextValue === "?") {
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
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
};

export function processInputSubmit(params: ProcessInputSubmitParams) {
  return resolveSubmitInput({
    value: params.value,
    atSuggestions: params.atSuggestions,
    atSuggestionIndex: params.atSuggestionIndex,
    slashSuggestions: params.slashSuggestions,
    slashSuggestionIndex: params.slashSuggestionIndex,
  });
}
