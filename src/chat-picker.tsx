import { Text } from "ink";
import type React from "react";
import { formatRelativeTime } from "./chat-format";
import type { PermissionMode } from "./config-modes";
import type { SkillMeta } from "./skills";
import type { Session } from "./types";

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number }
  | { kind: "permissions"; items: Array<{ mode: PermissionMode; description: string }>; index: number }
  | {
      kind: "clarifyAnswer";
      originalPrompt: string;
      question: string;
      remaining: string[];
      answers: Array<{ question: string; answer: string }>;
      items: Array<{ value: "continue"; description: string }>;
      index: number;
      note: string;
    }
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

export function pickerTitle(picker: PickerState): string {
  switch (picker.kind) {
    case "skills":
      return "Skills";
    case "resume":
      return "Resume Session";
    case "permissions":
      return "Permissions";
    case "clarifyAnswer":
      return truncateText(picker.question, 72);
    case "writeConfirm":
      return "Confirm Write Access";
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
    case "clarifyAnswer":
      return "Esc to close · Type answer inline · Enter to continue";
    case "writeConfirm":
      return "Esc to close · Type reason inline · Enter to apply";
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
    case "clarifyAnswer":
      return (
        <>
          {picker.items.map((item, index) => {
            const selected = index === picker.index;
            return (
              <Text key={item.value}>
                {selected ? "› " : "  "}
                <Text color={selected ? brandColor : undefined}>{item.value.padEnd(8)}</Text>
                <Text dimColor>{item.description}</Text>
              </Text>
            );
          })}
        </>
      );
    case "writeConfirm":
      return (
        <>
          <Text dimColor>{`  prompt: ${truncateText(picker.prompt, 72)}`}</Text>
          {picker.items.map((item, index) => {
            const selected = index === picker.index;
            return (
              <Text key={item.value}>
                {selected ? "› " : "  "}
                <Text color={selected ? brandColor : undefined}>{item.value.padEnd(8)}</Text>
                <Text dimColor>{item.description}</Text>
              </Text>
            );
          })}
        </>
      );
    case "resume": {
      const titleWidth = picker.items.reduce(
        (max, item) => Math.max(max, truncateText(item.title || "New Session", 40).length),
        0,
      );
      return picker.items.map((item, index) => {
        const selected = index === picker.index;
        const active = item.id === activeSessionId ? "●" : " ";
        const title = truncateText(item.title || "New Session", 40).padEnd(titleWidth);
        return (
          <Text key={item.id}>
            {selected ? "› " : "  "}
            <Text color={selected ? brandColor : undefined}>{`${active} ${item.id}`}</Text>
            {"  "}
            <Text dimColor>{`${title}  ${formatRelativeTime(item.updatedAt)}`}</Text>
          </Text>
        );
      });
    }
  }
}
