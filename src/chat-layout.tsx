import { homedir } from "node:os";
import { Text } from "ink";
import React from "react";
import type { SkillMeta } from "./skills";
import type { Session } from "./types";

export type PickerState =
  | { kind: "skills"; items: SkillMeta[]; index: number }
  | { kind: "resume"; items: Session[]; index: number };

const SHORTCUT_ITEMS = [
  { key: "@path", description: "attach file/dir context" },
  { key: "/changes", description: "show git changes" },
  { key: "/web <query>", description: "search the web" },
  { key: "/dogfood <task>", description: "run verify-first coding loop" },
  { key: "/dogfood-status (/ds)", description: "check dogfooding readiness" },
  { key: "/new", description: "new session" },
  { key: "/status", description: "show backend status" },
  { key: "/sessions", description: "list sessions" },
  { key: "/resume <id>", description: "resume session" },
  { key: "/skills", description: "open skills picker" },
  { key: "/remember [--project] <text>", description: "save memory note" },
  { key: "/memory", description: "list memories" },
  { key: "/tokens", description: "show token usage summary" },
  { key: "/exit", description: "exit chat" },
] as const;

function truncateText(input: string, max = 72): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

export function shownCwd(): string {
  const cwd = process.cwd();
  const home = homedir();
  if (cwd === home) {
    return "~";
  }
  if (cwd.startsWith(`${home}/`)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

export function borderLine(): string {
  const width = process.stdout.columns ?? 96;
  return "─".repeat(Math.max(24, width));
}

export function formatShortcutRows(): string[] {
  const width = process.stdout.columns ?? 96;
  const columns = width >= 92 ? 2 : 1;
  const rowsPerColumn = Math.ceil(SHORTCUT_ITEMS.length / columns);
  const colWidth = columns > 1 ? Math.floor((width - 2) / columns) : width - 2;
  const keyWidth = 16;
  const lines: string[] = [];

  for (let row = 0; row < rowsPerColumn; row += 1) {
    let line = "  ";
    for (let col = 0; col < columns; col += 1) {
      const index = row + col * rowsPerColumn;
      const item = SHORTCUT_ITEMS[index];
      if (!item) {
        continue;
      }
      const chunk = `${item.key.padEnd(keyWidth)}${item.description}`;
      line += col < columns - 1 ? chunk.padEnd(colWidth) : chunk;
    }
    lines.push(line.trimEnd());
  }

  return lines;
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
