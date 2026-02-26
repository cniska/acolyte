import { homedir } from "node:os";

const SHORTCUT_ITEMS = [
  { key: "@path", description: "attach file/dir" },
  { key: "/new", description: "new session" },
  { key: "/permissions", description: "permission mode" },
  { key: "/status", description: "backend status" },
  { key: "/sessions", description: "list sessions" },
  { key: "/resume <id>", description: "resume session" },
  { key: "/skills", description: "skills picker" },
  { key: "/remember <text>", description: "save memory note" },
  { key: "/memory [scope]", description: "list memories" },
  { key: "/tokens", description: "token usage" },
  { key: "/exit", description: "exit" },
] as const;

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
  const keyWidth = 20;
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
