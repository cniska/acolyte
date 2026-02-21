import { Text } from "ink";
import React from "react";
import type { SkillMeta } from "./skills";
import type { Session } from "./types";

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number };

function truncateText(input: string, max = 72): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

export function pickerTitle(picker: PickerState): string {
  return picker.kind === "skills" ? "Skills" : "Resume Session";
}

export function pickerHint(picker: PickerState): string {
  return picker.kind === "skills" ? "Esc to close · Enter to select" : "Esc to close · Enter to resume";
}

export function renderPickerItems(
  picker: PickerState,
  activeSessionId: string | undefined,
  brandColor: string,
): React.ReactNode {
  if (picker.kind === "skills") {
    const nameWidth = Math.min(28, Math.max(8, ...picker.items.map((item) => item.name.length)));
    return picker.items.map((skill, index) => {
      const selected = index === picker.index;
      return (
        <Text key={skill.path}>
          {selected ? "› " : "  "}
          <Text color={selected ? brandColor : undefined}>{skill.name.padEnd(nameWidth)}</Text>{" "}
          {truncateText(skill.description)}
        </Text>
      );
    });
  }

  return picker.items.map((item, index) => {
    const selected = index === picker.index;
    const prefix = item.id.slice(0, 12);
    const active = item.id === activeSessionId ? "●" : " ";
    return (
      <Text key={item.id}>
        {selected ? "› " : "  "}
        <Text color={selected ? brandColor : undefined}>{`${active} ${prefix}`}</Text>{" "}
        <Text dimColor>{truncateText(item.title || "New Session")}</Text>
      </Text>
    );
  });
}
