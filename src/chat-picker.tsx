import type React from "react";
import { unreachable } from "./assert";
import { alignCols } from "./chat-format";
import { truncateText } from "./compact-text";
import { formatRelativeTime } from "./datetime";
import { t } from "./i18n";
import type { Session } from "./session-contract";
import type { SkillMeta } from "./skill-contract";
import { Box, Text } from "./tui";

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
      query: string;
      index: number;
      scrollOffset: number;
      loading?: boolean;
    };

export const PICKER_PAGE_SIZE = 8;
export const PICKER_LABEL_WIDTH = 20;

function renderPickerRows(
  items: Array<{ key: string; label: string; detail?: string }>,
  selectedIndex: number,
  brandColor: string,
  labelWidth = PICKER_LABEL_WIDTH,
): React.ReactNode {
  return items.map((item, index) => {
    const selected = index === selectedIndex;
    return (
      <Box key={item.key}>
        <Text>{selected ? "› " : "  "}</Text>
        <Box width={labelWidth}>
          <Text color={selected ? brandColor : undefined}>{item.label}</Text>
        </Box>
        {item.detail ? (
          <>
            <Text> </Text>
            <Text dimColor>{item.detail}</Text>
          </>
        ) : null}
      </Box>
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
      return `${t("chat.picker.title.model")}: `;
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
      const maxLabel = Math.max(PICKER_LABEL_WIDTH, ...visible.map((item) => item.label.length + 2));
      return renderPickerRows(
        visible.map((item) => ({ key: item.value, label: item.label })),
        picker.index - picker.scrollOffset,
        brandColor,
        maxLabel,
      );
    }
    case "resume": {
      const rows = picker.items.map((item) => [
        `${item.id === activeSessionId ? "●" : " "} ${item.id}`,
        truncateText(item.title || t("chat.session.default_title"), 40),
        formatRelativeTime(item.updatedAt),
      ]);
      const formattedRows = alignCols(rows);
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
