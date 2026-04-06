import { stdout } from "node:process";

function hexToAnsi(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

const BRAND = hexToAnsi("#A56EFF");
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const ERASE_LINE = "\x1b[2K";
const CURSOR_UP = "\x1b[1A";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";

const BAR_FILL = "\u2588";
const BAR_EMPTY = "\u2591";

function progressBar(fraction: number, width: number): string {
  const filled = Math.round(fraction * width);
  const empty = width - filled;
  return `${BRAND}${BAR_FILL.repeat(filled)}${DIM}${BAR_EMPTY.repeat(empty)}${RESET}`;
}

export function renderUpdateHeader(current: string, latest: string): void {
  stdout.write(CURSOR_HIDE);
  stdout.write(`\n  ${BRAND}Acolyte${RESET} ${DIM}v${current}${RESET} → ${DIM}v${latest}${RESET}\n\n`);
  stdout.write(`  Downloading  ${progressBar(0, 20)}   0%\n`);
}

export function renderUpdateProgress(received: number, total: number): void {
  const fraction = total > 0 ? Math.min(received / total, 1) : 0;
  const percent = Math.round(fraction * 100);
  const bar = progressBar(fraction, 20);

  stdout.write(`${CURSOR_UP}${ERASE_LINE}`);
  stdout.write(`  Downloading  ${bar}  ${String(percent).padStart(3)}%\n`);
}

export function renderUpdateDone(latest: string): void {
  stdout.write(`${CURSOR_UP}${ERASE_LINE}`);
  stdout.write(`  ${GREEN}Updated to v${latest}${RESET}\n\n`);
  stdout.write(CURSOR_SHOW);
}

export function renderUpdateError(message: string): void {
  stdout.write(`${CURSOR_UP}${ERASE_LINE}`);
  stdout.write(`  ${RED}Update failed: ${message}${RESET}\n\n`);
  stdout.write(CURSOR_SHOW);
}
