import { clampSuggestionIndex } from "./chat-effects";
import { applyAtSuggestion, shouldAutocompleteAtSubmit } from "./chat-file-ref";
import { PICKER_PAGE_SIZE, type PickerState, pickerItemCount } from "./chat-picker";
import { shouldAutocompleteSlashSubmit } from "./chat-slash";
import { useInput } from "./tui";

type HistoryTransition = {
  nextIndex: number;
  nextValue: string;
  nextDraft?: string;
};

type ResolveTabAutocompleteInput = {
  browsingInputHistory: boolean;
  value: string;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  isTab: boolean;
};

export function resolveHistoryUp(
  inputHistory: string[],
  inputHistoryIndex: number,
  value: string,
): HistoryTransition | null {
  if (inputHistory.length === 0) return null;
  if (inputHistoryIndex === -1) {
    const nextIndex = inputHistory.length - 1;
    return {
      nextIndex,
      nextValue: inputHistory[nextIndex] ?? "",
      nextDraft: value,
    };
  }
  const nextIndex = Math.max(0, inputHistoryIndex - 1);
  return {
    nextIndex,
    nextValue: inputHistory[nextIndex] ?? "",
  };
}

export function resolveHistoryDown(
  inputHistory: string[],
  inputHistoryIndex: number,
  inputHistoryDraft: string,
): HistoryTransition | null {
  if (inputHistoryIndex < 0) return null;
  if (inputHistoryIndex >= inputHistory.length - 1) {
    return {
      nextIndex: -1,
      nextValue: inputHistoryDraft,
    };
  }
  const nextIndex = inputHistoryIndex + 1;
  return {
    nextIndex,
    nextValue: inputHistory[nextIndex] ?? "",
  };
}

export function resolveTabAutocomplete(input: ResolveTabAutocompleteInput): string | null {
  if (!input.isTab || input.browsingInputHistory) return null;
  if (input.atQuery !== null && input.atSuggestions.length > 0) {
    const selected = input.atSuggestions[clampSuggestionIndex(input.atSuggestionIndex, input.atSuggestions.length)];
    if (shouldAutocompleteAtSubmit(input.value, selected)) return applyAtSuggestion(input.value, selected ?? "");
  }
  if (input.atQuery === null && input.slashSuggestions.length > 0) {
    const selected =
      input.slashSuggestions[clampSuggestionIndex(input.slashSuggestionIndex, input.slashSuggestions.length)];
    if (shouldAutocompleteSlashSubmit(input.value, selected)) return selected ?? "";
  }
  return null;
}

export function resolveEscapeAction(input: { isPending: boolean; showHelp: boolean }): "interrupt" | "hide" | null {
  if (input.isPending) return "interrupt";
  if (input.showHelp) return "hide";
  return null;
}

export function shouldCycleInputHistory(inputHistoryIndex: number): boolean {
  return inputHistoryIndex >= -1;
}

type UseChatKeybindingsInput = {
  persist: () => Promise<void>;
  exit: () => void;
  picker: PickerState | null;
  setPicker: (next: PickerState | null | ((current: PickerState | null) => PickerState | null)) => void;
  handlePickerSelect: (picker: PickerState) => Promise<void>;
  inputHistory: string[];
  inputHistoryIndex: number;
  inputHistoryDraft: string;
  value: string;
  setValue: (next: string) => void;
  setInputRevision: (next: number | ((current: number) => number)) => void;
  applyingHistoryRef: { current: boolean };
  isPending: boolean;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  setAtSuggestionIndex: (next: number | ((current: number) => number)) => void;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  setSlashSuggestionIndex: (next: number | ((current: number) => number)) => void;
  setInputHistoryIndex: (next: number | ((current: number) => number)) => void;
  setInputHistoryDraft: (next: string) => void;
  openSkillsPanel: () => Promise<void>;
  showHelp: boolean;
  setShowHelp: (next: boolean | ((current: boolean) => boolean)) => void;
  interruptCurrentTurn: () => void;
  ctrlCPending: boolean;
  setCtrlCPending: (next: boolean) => void;
  cursorLineRef: { current: number };
};

export function useChatKeybindings(input: UseChatKeybindingsInput): void {
  useInput(
    (keyInput, key) => {
      if (key.ctrl && keyInput === "c") {
        if (input.ctrlCPending) {
          void input.persist().finally(input.exit);
          return;
        }
        input.setCtrlCPending(true);
        return;
      }
      if (input.picker) {
        if (key.escape) {
          input.setPicker(null);
          return;
        }
        if (key.upArrow) {
          input.setPicker((current) => {
            if (!current) return current;
            const index = Math.max(0, current.index - 1);
            if (current.kind === "model" || current.kind === "resume") {
              const scrollOffset = index < current.scrollOffset ? index : current.scrollOffset;
              return { ...current, index, scrollOffset };
            }
            return { ...current, index };
          });
          return;
        }
        if (key.downArrow) {
          input.setPicker((current) => {
            if (!current) return current;
            const index = Math.min(pickerItemCount(current) - 1, current.index + 1);
            if (current.kind === "model" || current.kind === "resume") {
              const scrollOffset =
                index >= current.scrollOffset + PICKER_PAGE_SIZE ? index - PICKER_PAGE_SIZE + 1 : current.scrollOffset;
              return { ...current, index, scrollOffset };
            }
            return { ...current, index };
          });
          return;
        }
        if (key.return && input.picker.kind !== "model") {
          if (pickerItemCount(input.picker) > 0) void input.handlePickerSelect(input.picker).catch(() => {});
          return;
        }
        return;
      }
      const browsingInputHistory = input.inputHistoryIndex >= 0;
      const suggestionNavActive =
        !browsingInputHistory &&
        (input.atQuery !== null || (input.atQuery === null && input.slashSuggestions.length > 0));
      const onFirstLine = input.cursorLineRef.current === 0;
      const historyTriggerUp = key.upArrow && onFirstLine;
      const historyTriggerDown = key.downArrow;
      if (!suggestionNavActive && historyTriggerUp) {
        if (!shouldCycleInputHistory(input.inputHistoryIndex)) return;
        const transition = resolveHistoryUp(input.inputHistory, input.inputHistoryIndex, input.value);
        if (!transition) return;
        if (transition.nextDraft !== undefined) input.setInputHistoryDraft(transition.nextDraft);
        input.setInputHistoryIndex(transition.nextIndex);
        input.applyingHistoryRef.current = true;
        input.setValue(transition.nextValue);
        input.setInputRevision((current) => current + 1);
        return;
      }
      if (!suggestionNavActive && historyTriggerDown && input.inputHistoryIndex >= 0) {
        const transition = resolveHistoryDown(input.inputHistory, input.inputHistoryIndex, input.inputHistoryDraft);
        if (!transition) return;
        input.setInputHistoryIndex(transition.nextIndex);
        input.applyingHistoryRef.current = true;
        input.setValue(transition.nextValue);
        input.setInputRevision((current) => current + 1);
        return;
      }
      if (!browsingInputHistory && input.atQuery !== null && input.atSuggestions.length > 0) {
        const autocompleted = resolveTabAutocomplete({
          browsingInputHistory,
          value: input.value,
          atQuery: input.atQuery,
          atSuggestions: input.atSuggestions,
          atSuggestionIndex: input.atSuggestionIndex,
          slashSuggestions: input.slashSuggestions,
          slashSuggestionIndex: input.slashSuggestionIndex,
          isTab: key.tab,
        });
        if (autocompleted !== null) {
          input.setValue(autocompleted);
          input.setInputRevision((current) => current + 1);
          return;
        }
        if (key.upArrow) {
          input.setAtSuggestionIndex((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow) {
          input.setAtSuggestionIndex((current) => Math.min(input.atSuggestions.length - 1, current + 1));
          return;
        }
      }
      if (!browsingInputHistory && input.atQuery === null && input.slashSuggestions.length > 0) {
        const autocompleted = resolveTabAutocomplete({
          browsingInputHistory,
          value: input.value,
          atQuery: input.atQuery,
          atSuggestions: input.atSuggestions,
          atSuggestionIndex: input.atSuggestionIndex,
          slashSuggestions: input.slashSuggestions,
          slashSuggestionIndex: input.slashSuggestionIndex,
          isTab: key.tab,
        });
        if (autocompleted !== null) {
          input.setValue(autocompleted);
          input.setInputRevision((current) => current + 1);
          return;
        }
        if (key.upArrow) {
          input.setSlashSuggestionIndex((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow) {
          input.setSlashSuggestionIndex((current) => Math.min(input.slashSuggestions.length - 1, current + 1));
          return;
        }
      }
      if (!input.isPending && keyInput === "$" && input.value.length === 0) {
        void input.openSkillsPanel();
        return;
      }
      if (keyInput === "?" && input.value.length === 0) {
        input.setShowHelp((current) => !current);
        return;
      }
      if (key.escape) {
        const action = resolveEscapeAction({ isPending: input.isPending, showHelp: input.showHelp });
        if (action === "interrupt") {
          input.interruptCurrentTurn();
          return;
        }
        if (action === "hide") input.setShowHelp(false);
        if (input.ctrlCPending) input.setCtrlCPending(false);
      }
    },
    { isActive: Boolean(process.stdin.isTTY) },
  );
}
