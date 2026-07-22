import type { InputControllerState } from "./input-controller";
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

export function pickerItemCount(picker: PickerState): number {
  switch (picker.kind) {
    case "model":
      return picker.filtered.length;
    default:
      return picker.items.length;
  }
}
