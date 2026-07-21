import { z } from "zod";
import type { TerminalCursor, TerminalLine, TerminalScene } from "./terminal-scene-contract";
import type { TerminalStyleRole } from "./terminal-theme";

export const terminalConstraintsSchema = z.object({
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type TerminalConstraints = z.infer<typeof terminalConstraintsSchema>;
export const composerPresentationSchema = z.object({
  text: z.string(),
  cursor: z.number().int().nonnegative(),
  placeholder: z.string().optional(),
});
export type ComposerPresentation = z.infer<typeof composerPresentationSchema>;

function graphemes(text: string): string[] {
  return [...new Intl.Segmenter().segment(text)].map((part) => part.segment);
}
function width(text: string): number {
  return Bun.stringWidth(text);
}
function truncate(text: string, columns: number): string {
  if (width(text) <= columns) return text;
  if (columns <= 1) return "…".slice(0, columns);
  let output = "";
  for (const part of graphemes(text)) {
    if (width(output) + width(part) > columns - 1) break;
    output += part;
  }
  return `${output}…`;
}
export function wrapTerminalText(text: string, columns: number): string[] {
  const output: string[] = [];
  for (const logical of text.split("\n")) {
    let line = "";
    for (const part of graphemes(logical)) {
      if (width(line) + width(part) > columns && line) {
        output.push(line);
        line = "";
      }
      line += part;
    }
    output.push(line);
  }
  return output.length ? output : [""];
}
export function layoutComposer(
  input: ComposerPresentation,
  constraints: TerminalConstraints,
): { lines: TerminalLine[]; cursor: TerminalCursor } {
  const inner = Math.max(1, constraints.columns - 4);
  const prefix = "❯ ";
  const text = input.text || input.placeholder || "";
  const segments = wrapTerminalText(text, inner - width(prefix));
  const lines = [
    { spans: [{ text: `╭${"─".repeat(Math.max(0, constraints.columns - 2))}╮`, role: "composer-border" as const }] },
    ...segments.map((segment, index) => ({
      spans: [
        { text: "│ ", role: "composer-border" as const },
        { text: index === 0 ? prefix : "  ", role: "composer-prompt" as const },
        { text: segment, role: "plain" as const },
        { text: " ", role: "plain" as const },
        { text: "│", role: "composer-border" as const },
      ],
    })),
    { spans: [{ text: `╰${"─".repeat(Math.max(0, constraints.columns - 2))}╯`, role: "composer-border" as const }] },
  ];
  const before = input.text.slice(0, Math.min(input.cursor, input.text.length));
  const cursorLine = wrapTerminalText(before, inner - width(prefix)).length - 1;
  const cursorText = wrapTerminalText(before, inner - width(prefix)).at(-1) ?? "";
  return { lines, cursor: { row: cursorLine + 1, column: 2 + width(prefix) + width(cursorText) } };
}
export function layoutTerminalChat(input: {
  body: Array<{ text: string; role: TerminalStyleRole }>;
  composer: ComposerPresentation;
  constraints: TerminalConstraints;
}): TerminalScene {
  const body = input.body.flatMap((item) =>
    wrapTerminalText(item.text, input.constraints.columns - 2).map((text) => ({
      spans: [
        { text: "⬡ ", role: item.role },
        { text, role: item.role },
      ],
    })),
  );
  const composer = layoutComposer(input.composer, input.constraints);
  return {
    lines: [...body, ...composer.lines],
    cursor: { ...composer.cursor, row: composer.cursor.row + body.length },
  };
}

export function layoutTranscriptMessage(input: {
  text: string;
  kind: "user" | "assistant";
  columns: number;
}): TerminalScene {
  const marker = input.kind === "user" ? "❯ " : "• ";
  const role = input.kind;
  const lines = wrapTerminalText(input.text, Math.max(24, input.columns - 2)).map((text, index) => ({
    spans: [
      { text: index === 0 ? marker : "  ", role },
      { text, role },
    ],
  }));
  return { lines };
}
export { truncate as truncateTerminalText };
