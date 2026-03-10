import { Text } from "ink";
import type React from "react";
import type { AgentMode } from "./agent-contract";
import { unreachable } from "./assert";
import { formatColumns, formatRelativeTime } from "./chat-format";
import { truncateText } from "./compact-text";
import type { Session } from "./session-contract";
import type { SkillMeta } from "./skills";

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number }
  | {
      kind: "model";
      items: string[];
      filtered: string[];
      query: string;
      index: number;
      scrollOffset: number;
      targetMode?: AgentMode;
    };

export const PICKER_PAGE_SIZE = 8;
export const PICKER_LABEL_WIDTH = 20;

function renderPickerRows(
  items: Array<{ key: string; label: string; detail: string }>,
  selectedIndex: number,
  brandColor: string,
): React.ReactNode {
  return items.map((item, index) => {
    const selected = index === selectedIndex;
    return (
      <Text key={item.key}>
        {selected ? "› " : "  "}
        <Text color={selected ? brandColor : undefined}>{item.label.padEnd(PICKER_LABEL_WIDTH)}</Text>
        {item.detail ? (
          <>
            <Text> </Text>
            <Text dimColor>{item.detail}</Text>
          </>
        ) : null}
      </Text>
    );
  });
}

export function pickerTitle(picker: PickerState, caretVisible = true): string {
  switch (picker.kind) {
    case "skills":
      return "Skills";
    case "resume":
      return "Resume Session";
    case "model": {
      const label = picker.targetMode ? `Model (${picker.targetMode})` : "Model";
      return `${label}: ${picker.query}${caretVisible ? "\u2588" : ""}`;
    }
    default:
      return unreachable(picker);
  }
}

export function pickerHint(picker: PickerState): string {
  switch (picker.kind) {
    case "skills":
      return "Enter to select · Esc to close";
    case "resume":
      return "Enter to resume · Esc to close";
    case "model":
      return "Type to filter · Enter to apply · Esc to close";
    default:
      return unreachable(picker);
  }
}

export function pickerItemCount(picker: PickerState): number {
  switch (picker.kind) {
    case "model":
      return picker.filtered.length;
    default:
      return picker.items.length;
  }
}

export function renderPickerItems(
  picker: PickerState,
  activeSessionId: string | undefined,
  brandColor: string,
): React.ReactNode {
  switch (picker.kind) {
    case "skills": {
      return renderPickerRows(
        picker.items.map((skill) => ({
          key: skill.path,
          label: truncateText(skill.name, PICKER_LABEL_WIDTH),
          detail: truncateText(skill.description, 72),
        })),
        picker.index,
        brandColor,
      );
    }
    case "model": {
      if (picker.filtered.length === 0) {
        return <Text dimColor> No matches.</Text>;
      }
      const visible = picker.filtered.slice(picker.scrollOffset, picker.scrollOffset + PICKER_PAGE_SIZE);
      return renderPickerRows(
        visible.map((id) => ({
          key: id,
          label: truncateText(id, PICKER_LABEL_WIDTH),
          detail: "",
        })),
        picker.index - picker.scrollOffset,
        brandColor,
      );
    }
    case "resume": {
      const rows = picker.items.map((item) => [
        `${item.id === activeSessionId ? "●" : " "} ${item.id}`,
        truncateText(item.title || "New Session", 40),
        formatRelativeTime(item.updatedAt),
      ]);
      const formattedRows = formatColumns(rows);
      return formattedRows.map((line, index) => {
        const selected = index === picker.index;
        return (
          <Text key={picker.items[index]?.id ?? `${index}`}>
            {selected ? "› " : "  "}
            <Text color={selected ? brandColor : undefined}>{line}</Text>
          </Text>
        );
      });
    }
    default:
      return unreachable(picker);
  }
}
