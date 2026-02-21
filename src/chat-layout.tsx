import { homedir } from "node:os";

const SHORTCUT_ITEMS = [
  { key: "@path", description: "attach file/dir context" },
  { key: "/changes", description: "show git changes" },
  { key: "/web <query>", description: "search the web" },
  { key: "/fetch <url>", description: "fetch page text" },
  { key: "/dogfood <task>", description: "run verify-first coding loop" },
  { key: "/new", description: "new session" },
  { key: "/permissions", description: "show permission mode" },
  { key: "/status", description: "show backend status" },
  { key: "/sessions", description: "list sessions" },
  { key: "/resume <id>", description: "resume session" },
  { key: "/skills", description: "open skills picker" },
  { key: "/remember [--project] <text>", description: "save memory note" },
  { key: "/memory", description: "list memories" },
  { key: "/distill", description: "distill policy from chat logs" },
  { key: "/tokens", description: "show token usage summary" },
  { key: "/exit", description: "exit chat" },
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
