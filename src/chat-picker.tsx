import { Text } from "ink";
import type React from "react";
import type { AgentMode } from "./agent-contract";
import { unreachable } from "./assert";
import { formatColumns, formatRelativeTime } from "./chat-format";
import { truncateText } from "./compact-text";
import { t } from "./i18n";
import type { Session } from "./session-contract";
import type { SkillMeta } from "./skills";

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number; scrollOffset: number }
  | {
      kind: "model";
      items: string[];
      filtered: string[];
      query: string;
      index: number;
      scrollOffset: number;
      targetMode?: AgentMode;
      loading?: boolean;
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

export function pickerLabel(picker: PickerState): string {
  switch (picker.kind) {
    case "skills":
      return t("chat.picker.title.skills");
    case "resume":
      return t("chat.picker.title.resume");
    case "model":
      return picker.targetMode
        ? `${t("chat.picker.title.model.mode", { mode: picker.targetMode })}: `
        : `${t("chat.picker.title.model")}: `;
    default:
      return unreachable(picker);
  }
}

export function pickerHint(picker: PickerState): string {
  switch (picker.kind) {
    case "skills":
      return t("chat.picker.hint.skills");
    case "resume":
      return t("chat.picker.hint.resume");
    case "model":
      return t("chat.picker.hint.model");
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
      if (picker.loading) {
        return <Text dimColor>{`  ${t("chat.picker.loading")}`}</Text>;
      }
      if (picker.filtered.length === 0) {
        return <Text dimColor> {t("chat.picker.no_matches")}</Text>;
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
        truncateText(item.title || t("chat.session.default_title"), 40),
        formatRelativeTime(item.updatedAt),
      ]);
      const formattedRows = formatColumns(rows);
      const visible = formattedRows.slice(picker.scrollOffset, picker.scrollOffset + PICKER_PAGE_SIZE);
      const visibleItems = picker.items.slice(picker.scrollOffset, picker.scrollOffset + PICKER_PAGE_SIZE);
      return visible.map((line, index) => {
        const selected = index === picker.index - picker.scrollOffset;
        return (
          <Text key={visibleItems[index]?.id ?? `${index}`}>
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
