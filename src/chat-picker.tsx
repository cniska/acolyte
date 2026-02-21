import { Text } from "ink";
import React from "react";
import type { SkillMeta } from "./skills";
import type { Session } from "./types";

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number }
  | { kind: "permissions"; items: Array<{ mode: "read" | "write"; description: string }>; index: number };

function truncateText(input: string, max = 72): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

export function pickerTitle(picker: PickerState): string {
  switch (picker.kind) {
    case "skills":
      return "Skills";
    case "resume":
      return "Resume Session";
    case "permissions":
      return "Permissions";
  }
}

export function pickerHint(picker: PickerState): string {
  switch (picker.kind) {
    case "skills":
      return "Esc to close · Enter to select";
    case "resume":
      return "Esc to close · Enter to resume";
    case "permissions":
      return "Esc to close · Enter to apply";
  }
}

export function renderPickerItems(
  picker: PickerState,
  activeSessionId: string | undefined,
  brandColor: string,
): React.ReactNode {
  switch (picker.kind) {
    case "skills": {
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
    case "permissions":
      return picker.items.map((item, index) => {
        const selected = index === picker.index;
        return (
          <Text key={item.mode}>
            {selected ? "› " : "  "}
            <Text color={selected ? brandColor : undefined}>{item.mode.padEnd(10)}</Text>
            <Text dimColor>{item.description}</Text>
          </Text>
        );
      });
    case "resume":
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
}
