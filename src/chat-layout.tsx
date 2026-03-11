import { homedir } from "node:os";
import { slashCommandHelp } from "./chat-slash";
import { t } from "./i18n";

const DEFAULT_TERMINAL_WIDTH = 96;
const SHORTCUT_TWO_COLUMN_MIN_WIDTH = 92;

const SHORTCUT_ITEMS = [
  { key: "@path", description: t("chat.at_ref.attach_file") },
  { key: "/new", description: slashCommandHelp("/new") },
  { key: "/resume <id>", description: slashCommandHelp("/resume") },
  { key: "/sessions", description: slashCommandHelp("/sessions") },
  { key: "/model", description: slashCommandHelp("/model") },
  { key: "/status", description: slashCommandHelp("/status") },
  { key: "/remember <text>", description: slashCommandHelp("/remember") },
  { key: "/memory [scope]", description: slashCommandHelp("/memory") },
  { key: "/tokens", description: slashCommandHelp("/tokens") },
  { key: "/skills", description: slashCommandHelp("/skills") },
  { key: "/exit", description: slashCommandHelp("/exit") },
] as const;

export function shownCwd(): string {
  const cwd = process.cwd();
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export async function shownBranch(cwd = process.cwd()): Promise<string | null> {
  const proc = Bun.spawn({
    cmd: ["git", "branch", "--show-current"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdoutText] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) return null;
  const branch = stdoutText.trim();
  return branch.length > 0 ? branch : null;
}

export function justifyLineSpaceBetween(left: string, right: string, inset = 0): string {
  const width = process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH;
  const safeInset = Math.max(0, inset);
  const leftText = `${" ".repeat(safeInset)}${left}`;
  const rightText = `${right}${" ".repeat(safeInset)}`;
  const minGap = 1;
  const required = leftText.length + minGap + rightText.length;
  if (required > width) return `${leftText} · ${rightText}`;
  return `${leftText}${" ".repeat(width - leftText.length - rightText.length)}${rightText}`;
}

export function borderLine(): string {
  const width = process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH;
  return "─".repeat(Math.max(24, width));
}

export function formatShortcutRows(): string[] {
  const width = process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH;
  const columns = width >= SHORTCUT_TWO_COLUMN_MIN_WIDTH ? 2 : 1;
  const rowsPerColumn = Math.ceil(SHORTCUT_ITEMS.length / columns);
  const colWidth = columns > 1 ? Math.min(40, Math.floor((width - 2) / columns)) : width - 2;
  const keyWidth = 20;
  const lines: string[] = [];

  for (let row = 0; row < rowsPerColumn; row += 1) {
    let line = "  ";
    for (let col = 0; col < columns; col += 1) {
      const index = row + col * rowsPerColumn;
      const item = SHORTCUT_ITEMS[index];
      if (!item) continue;
      const chunk = `${item.key.padEnd(keyWidth)}${item.description}`;
      line += col < columns - 1 ? chunk.padEnd(colWidth) : chunk;
    }
    lines.push(line.trimEnd());
  }

  return lines;
}
