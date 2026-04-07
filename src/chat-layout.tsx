import { slashCommandHelp } from "./chat-slash";
import { resolveHomeDir } from "./home-dir";
import { t } from "./i18n";
import { DEFAULT_TERMINAL_WIDTH } from "./tui/constants";

/** Terminal width at which help pane switches from 1 to 2 columns. */
export const BREAKPOINT_TWO_COLUMN = 92;

export const SHORTCUT_ITEMS = [
  { key: "@path", description: t("chat.at_ref.attach_file") },
  { key: "/new", description: slashCommandHelp("/new") },
  { key: "/resume <id>", description: slashCommandHelp("/resume") },
  { key: "/sessions", description: slashCommandHelp("/sessions") },
  { key: "/model", description: slashCommandHelp("/model") },
  { key: "/status", description: slashCommandHelp("/status") },
  { key: "/remember <text>", description: slashCommandHelp("/remember") },
  { key: "/memory [scope]", description: slashCommandHelp("/memory") },
  { key: "/usage", description: slashCommandHelp("/usage") },
  { key: "/skills", description: slashCommandHelp("/skills") },
  { key: "/exit", description: slashCommandHelp("/exit") },
] as const;

export function shownCwd(): string {
  const cwd = process.cwd();
  const home = resolveHomeDir();
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

export function borderLine(): string {
  const width = process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH;
  return "─".repeat(Math.max(24, width));
}
