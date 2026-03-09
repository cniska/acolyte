import { Text } from "ink";
import type React from "react";
import type { AgentMode } from "./agent-modes";
import { unreachable } from "./assert";
import { formatColumns, formatRelativeTime } from "./chat-format";
import type { Session } from "./session-contract";
import type { SkillMeta } from "./skills";

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number }
  | {
      kind: "model";
      items: Array<{ model: string; name: string; description: string }>;
      index: number;
      targetMode?: AgentMode;
    };

function truncateText(input: string, max = 72): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

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

export function pickerTitle(picker: PickerState): string {
  switch (picker.kind) {
    case "skills":
      return "Skills";
    case "resume":
      return "Resume Session";
    case "model":
      return picker.targetMode ? `Model (${picker.targetMode})` : "Model";
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
      return "Enter to apply · Esc to close";
    default:
      return unreachable(picker);
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
          detail: truncateText(skill.description),
        })),
        picker.index,
        brandColor,
      );
    }
    case "model":
      return renderPickerRows(
        picker.items.map((item) => ({
          key: item.model,
          label: truncateText(item.name, PICKER_LABEL_WIDTH),
          detail: item.description,
        })),
        picker.index,
        brandColor,
      );
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
