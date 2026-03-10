import { stdout } from "node:process";
import { palette } from "./palette";

function hexToAnsi(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

const color = {
  dim: (value: string): string => `\x1b[2m${value}\x1b[22m`,
  brand: (value: string): string => `${hexToAnsi(palette.brand)}${value}\x1b[39m`,
  white: (value: string): string => `\x1b[37m${value}\x1b[39m`,
  green: (value: string): string => `\x1b[32m${value}\x1b[39m`,
  yellow: (value: string): string => `\x1b[33m${value}\x1b[39m`,
  red: (value: string): string => `\x1b[31m${value}\x1b[39m`,
  bold: (value: string): string => `\x1b[1m${value}\x1b[22m`,
};

export function formatCliTitle(version: string): string {
  return `${color.brand("Acolyte")}${color.dim(color.white(` v${version}`))}`;
}

export function tokenizeStreamContent(content: string): string[] {
  return content.split(/(\s+)/).filter((part) => part.length > 0);
}

export async function streamText(content: string): Promise<void> {
  for (const token of tokenizeStreamContent(content)) {
    stdout.write(token);
    if (!/^\s+$/.test(token)) await Bun.sleep(12);
  }
  if (!content.endsWith("\n")) stdout.write("\n");
}

export function printDim(content: string): void {
  stdout.write(`${color.dim(content)}\n`);
}

export function printToolHeader(title: string, detail?: string): void {
  const base = color.bold(color.white(title));
  const suffix = detail ? ` ${color.dim(detail)}` : "";
  stdout.write(`${base}${suffix}\n`);
}

export function printOutput(content: string): void {
  stdout.write(`${content}\n`);
}

export function printWarning(content: string): void {
  stdout.write(`${color.dim(color.yellow(content))}\n`);
}

export function printError(content: string): void {
  stdout.write(`${color.red(content)}\n`);
}

export function clearScreen(): void {
  stdout.write("\x1b[2J\x1b[H");
}
