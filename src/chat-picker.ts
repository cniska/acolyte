import { suggestModels } from "./chat-model-autocomplete";
import { type InputControllerState, type InputEditAction, reduceInput } from "./input-controller";
import type { Session } from "./session-contract";
import type { SkillMeta } from "./skill-contract";

export type ModelPickerItem = {
  label: string;
  value: string;
};

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number; scrollOffset: number }
  | {
      kind: "model";
      items: ModelPickerItem[];
      filtered: ModelPickerItem[];
      input: InputControllerState;
      index: number;
      scrollOffset: number;
      loading?: boolean;
    };

export const PICKER_PAGE_SIZE = 8;
export const PICKER_LABEL_WIDTH = 20;

export type ModelPickerState = Extract<PickerState, { kind: "model" }>;

// Query edits re-filter and reset the selection; cursor-only motion (the arrow keys the
// keybindings use to move the selection also reach the query input) must leave it alone.
export function reduceModelPickerAction(current: ModelPickerState, action: InputEditAction): ModelPickerState {
  const nextInput = reduceInput(current.input, action);
  if (nextInput.text === current.input.text) return { ...current, input: nextInput };
  return {
    ...current,
    input: nextInput,
    filtered: suggestModels(nextInput.text, current.items),
    index: 0,
    scrollOffset: 0,
  };
}

export function pickerItemCount(picker: PickerState): number {
  switch (picker.kind) {
    case "model":
      return picker.filtered.length;
    default:
      return picker.items.length;
  }
}
