import { Text } from "ink";
import type React from "react";
import { formatColumns, formatRelativeTime } from "./chat-format";
import type { PermissionMode } from "./config-contract";
import type { SkillMeta } from "./skills";
import type { Session } from "./session-types";

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number }
  | { kind: "permissions"; items: Array<{ mode: PermissionMode; description: string }>; index: number }
  | { kind: "model"; items: Array<{ model: string; description: string }>; index: number; customModel: string }
  | {
      kind: "writeConfirm";
      prompt: string;
      items: Array<{ value: "switch" | "cancel"; description: string }>;
      index: number;
      note: string;
    };

function truncateText(input: string, max = 72): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

export const PICKER_LABEL_WIDTH = 16;

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
    case "permissions":
      return "Permissions";
    case "model":
      return "Model";
    case "writeConfirm":
      return "Confirm Write Access";
  }
}

export function pickerHint(picker: PickerState): string {
  switch (picker.kind) {
    case "skills":
      return "Enter to select · Esc to close";
    case "resume":
      return "Enter to resume · Esc to close";
    case "permissions":
      return "Enter to apply · Esc to close";
    case "model":
      return "Select other to type · Enter to apply · Esc to close";
    case "writeConfirm":
      return "Enter to apply · Esc to cancel";
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
    case "permissions":
      return renderPickerRows(
        picker.items.map((item) => ({
          key: item.mode,
          label: item.mode,
          detail: item.description,
        })),
        picker.index,
        brandColor,
      );
    case "model":
      return (
        <>
          {picker.items.map((item, index) => {
            const selected = index === picker.index;
            const isOther = item.model === "other";
            const emptyOther = isOther && picker.customModel.trim().length === 0;
            const label = isOther
              ? picker.customModel.trim().length > 0
                ? picker.customModel
                : "other"
              : truncateText(item.model, PICKER_LABEL_WIDTH);
            return (
              <Text key={item.model}>
                {selected ? "› " : "  "}
                <Text color={selected && !emptyOther ? brandColor : undefined} dimColor={emptyOther && selected}>
                  {label.padEnd(PICKER_LABEL_WIDTH)}
                </Text>
                {item.description ? (
                  <>
                    <Text> </Text>
                    <Text dimColor>{item.description}</Text>
                  </>
                ) : null}
              </Text>
            );
          })}
        </>
      );
    case "writeConfirm":
      return (
        <>
          <Text dimColor>{`  prompt: ${truncateText(picker.prompt, 72)}`}</Text>
          {renderPickerRows(
            picker.items.map((item) => ({
              key: item.value,
              label: item.value,
              detail: item.description,
            })),
            picker.index,
            brandColor,
          )}
        </>
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
  }
}
