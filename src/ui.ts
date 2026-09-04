import { stderr, stdout } from "node:process";
import { BRAILLE_BLANK, diagonalPosition, gradientRgb } from "./brand-gradient";
import { BRAND_WORDMARK_GAP, BRAND_WORDMARK_ROWS } from "./brand-mark";
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

/** Diagnostics share the sink when one is installed, and stderr otherwise, so stdout stays a data stream. */
function writeErrorChunk(chunk: string): void {
  if (uiSink) {
    uiSink(chunk);
    return;
  }
  stderr.write(chunk);
}

function hexToAnsi(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

/** Escapes are for a terminal that renders them, not for a pipe, a file, or a NO_COLOR session. */
function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  return stdout.isTTY === true;
}

function paint(wrap: (value: string) => string): (value: string) => string {
  return (value: string) => (colorEnabled() ? wrap(value) : value);
}

export const dimText = paint((value) => `\x1b[2m${value}\x1b[22m`);

const color = {
  dim: dimText,
  brand: paint((value) => `${hexToAnsi(palette.brand)}${value}\x1b[39m`),
  white: paint((value) => `\x1b[37m${value}\x1b[39m`),
  green: paint((value) => `\x1b[32m${value}\x1b[39m`),
  yellow: paint((value) => `\x1b[33m${value}\x1b[39m`),
  red: paint((value) => `\x1b[31m${value}\x1b[39m`),
  bold: paint((value) => `\x1b[1m${value}\x1b[22m`),
};

/** Paints braille art cell by cell along the brand gradient, coalescing runs of one color. */
function paintGradient(rows: ReadonlyArray<string>): string[] {
  if (!colorEnabled()) return [...rows];
  const width = Math.max(...rows.map((row) => [...row].length));
  return rows.map((row, y) => {
    let painted = "";
    let current = "";
    for (const [x, cell] of [...row].entries()) {
      if (cell === BRAILLE_BLANK) {
        painted += cell;
        continue;
      }
      const [r, g, b] = gradientRgb(diagonalPosition(x, y, width, rows.length));
      const sgr = `\x1b[38;2;${r};${g};${b}m`;
      if (sgr !== current) {
        painted += sgr;
        current = sgr;
      }
      painted += cell;
    }
    return current ? `${painted}\x1b[39m` : painted;
  });
}

/** The full wordmark, with the version set under the lettering. */
export function formatCliBanner(version: string): string {
  const art = BRAND_WORDMARK_ROWS.map((row) => row.chevron + BRAND_WORDMARK_GAP + row.word);
  const indent = " ".repeat([...BRAND_WORDMARK_ROWS[0].chevron, ...BRAND_WORDMARK_GAP].length);
  return [...paintGradient(art), `${indent}${color.dim(color.white(`v${version}`))}`].join("\n");
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
  const head = glyphColor ? paint((value) => `${hexToAnsi(glyphColor)}${value}\x1b[39m`)(glyph) : color.dim(glyph);
  return `${head} ${color.dim(rest)}`;
}

export const headingText = (content: string): string => color.bold(color.white(content));

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
  writeErrorChunk(`${warningText(content)}\n`);
}

export function printError(content: string): void {
  writeErrorChunk(`${errorText(content)}\n`);
}

/** Already-formatted detail belonging to the error above it, so the two stay on one stream. */
export function printErrorDetail(content: string): void {
  writeErrorChunk(`${content}\n`);
}

export function clearScreen(): void {
  writeChunk(ansi.clearScreen);
}
