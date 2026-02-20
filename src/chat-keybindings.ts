import { useInput } from "ink";
import { applyAtSuggestion, shouldAutocompleteAtSubmit } from "./chat-file-ref";
import { applySlashSuggestion, shouldAutocompleteSlashSubmit } from "./chat-slash";
import type { PickerState } from "./chat-layout";

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
  isThinking: boolean;
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
  showShortcuts: boolean;
  setShowShortcuts: (next: boolean | ((current: boolean) => boolean)) => void;
};

export function useChatKeybindings(input: UseChatKeybindingsInput): void {
  useInput(
    (keyInput, key) => {
      if (key.ctrl && keyInput === "c") {
        void input.persist().finally(input.exit);
        return;
      }
      if (input.picker) {
        if (key.escape) {
          input.setPicker(null);
          return;
        }
        if (key.upArrow || keyInput === "k") {
          input.setPicker((current) => (current ? { ...current, index: Math.max(0, current.index - 1) } : current));
          return;
        }
        if (key.downArrow || keyInput === "j") {
          input.setPicker((current) =>
            current ? { ...current, index: Math.min(current.items.length - 1, current.index + 1) } : current,
          );
          return;
        }
        if (key.return && input.picker.items.length > 0) {
          void input.handlePickerSelect(input.picker);
          return;
        }
        return;
      }
      const browsingInputHistory = input.inputHistoryIndex >= 0;
      const suggestionNavActive =
        !browsingInputHistory &&
        (input.atQuery !== null || (input.atQuery === null && input.slashSuggestions.length > 0));
      if (!input.isThinking && !suggestionNavActive && key.upArrow) {
        if (input.inputHistory.length === 0) {
          return;
        }
        if (input.inputHistoryIndex === -1) {
          input.setInputHistoryDraft(input.value);
          const nextIndex = input.inputHistory.length - 1;
          input.setInputHistoryIndex(nextIndex);
          input.applyingHistoryRef.current = true;
          input.setValue(input.inputHistory[nextIndex] ?? "");
          input.setInputRevision((current) => current + 1);
          return;
        }
        const nextIndex = Math.max(0, input.inputHistoryIndex - 1);
        input.setInputHistoryIndex(nextIndex);
        input.applyingHistoryRef.current = true;
        input.setValue(input.inputHistory[nextIndex] ?? "");
        input.setInputRevision((current) => current + 1);
        return;
      }
      if (!input.isThinking && !suggestionNavActive && key.downArrow && input.inputHistoryIndex >= 0) {
        if (input.inputHistoryIndex >= input.inputHistory.length - 1) {
          input.setInputHistoryIndex(-1);
          input.applyingHistoryRef.current = true;
          input.setValue(input.inputHistoryDraft);
          input.setInputRevision((current) => current + 1);
          return;
        }
        const nextIndex = input.inputHistoryIndex + 1;
        input.setInputHistoryIndex(nextIndex);
        input.applyingHistoryRef.current = true;
        input.setValue(input.inputHistory[nextIndex] ?? "");
        input.setInputRevision((current) => current + 1);
        return;
      }
      if (!browsingInputHistory && input.atQuery !== null && input.atSuggestions.length > 0) {
        const selected =
          input.atSuggestions[Math.max(0, Math.min(input.atSuggestionIndex, input.atSuggestions.length - 1))];
        if (key.tab && shouldAutocompleteAtSubmit(input.value, selected)) {
          input.setValue(applyAtSuggestion(input.value, selected ?? ""));
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
        const selected =
          input.slashSuggestions[Math.max(0, Math.min(input.slashSuggestionIndex, input.slashSuggestions.length - 1))];
        if (key.tab && shouldAutocompleteSlashSubmit(input.value, selected)) {
          input.setValue(applySlashSuggestion(selected ?? ""));
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
      if (!input.isThinking && keyInput === "$" && input.value.length === 0) {
        void input.openSkillsPanel();
        return;
      }
      if (!input.isThinking && keyInput === "?" && input.value.length === 0) {
        input.setShowShortcuts((current) => !current);
        return;
      }
      if (key.escape && input.showShortcuts) {
        input.setShowShortcuts(false);
      }
    },
    { isActive: Boolean(process.stdin.isTTY) },
  );
}
