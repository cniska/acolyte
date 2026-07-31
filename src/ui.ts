import { stdout } from "node:process";
import { palette } from "./palette";
import { ansi } from "./tui/styles";

let uiSink: ((chunk: string) => void) | null = null;

export function setUiSink(sink: ((chunk: string) => void) | null): void {
  uiSink = sink;
}

export function writeChunk(chunk: string): void {
  if (uiSink) {
    uiSink(chunk);
    return;
  }
  stdout.write(chunk);
}

function hexToAnsi(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

export const dimText = (value: string): string => `\x1b[2m${value}\x1b[22m`;

const color = {
  dim: dimText,
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
    writeChunk(token);
    if (!/^\s+$/.test(token)) await Bun.sleep(12);
  }
  if (!content.endsWith("\n")) writeChunk("\n");
}

export function printDim(content: string): void {
  writeChunk(`${color.dim(content)}\n`);
}

/** A dimmed line led by a marker glyph, tinted `glyphColor` (hex) when set — else dim. */
export function formatMarkerLine(glyph: string, glyphColor: string | undefined, rest: string): string {
  const head = glyphColor ? `${hexToAnsi(glyphColor)}${glyph}\x1b[39m` : color.dim(glyph);
  return `${head} ${color.dim(rest)}`;
}

export const warningText = (content: string): string => color.dim(color.yellow(content));

export const errorText = (content: string): string => color.red(content);

export function printToolHeader(title: string, detail?: string): void {
  const base = color.bold(color.white(title));
  const suffix = detail ? ` ${color.dim(detail)}` : "";
  writeChunk(`${base}${suffix}\n`);
}

export function printOutput(content: string): void {
  writeChunk(`${content}\n`);
}

export function printWarning(content: string): void {
  writeChunk(`${warningText(content)}\n`);
}

export function printError(content: string): void {
  writeChunk(`${errorText(content)}\n`);
}

export function clearScreen(): void {
  writeChunk(ansi.clearScreen);
}
