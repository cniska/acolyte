import { z } from "zod";
import { formatCommandOutput, formatCompactNumber } from "./chat-format";
import type { ChatViewportPresentation, PendingPresentation } from "./chat-viewport-contract";
import type { ChecklistOutput } from "./checklist-contract";
import { formatChecklist } from "./checklist-format";
import { t } from "./i18n";
import type { TerminalCursor, TerminalLine, TerminalScene } from "./terminal-scene-contract";
import type { TerminalStyleRole, TerminalTheme } from "./terminal-theme";
import type { ToolOutputPart } from "./tool-output-contract";
import { fitLine, layoutToolOutput, segmentsWidth } from "./tool-output-layout";

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
export function wrapTerminalProse(text: string, columns: number): string[] {
  return text.split("\n").flatMap((logical) => {
    if (!logical) return [""];
    const lines: string[] = [];
    let line = "";
    for (const word of logical.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && width(candidate) > columns) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    return [...lines, line];
  });
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
  const lines = wrapTerminalProse(input.text, Math.max(24, input.columns - 2)).map((text, index) => ({
    spans: [
      { text: index === 0 ? marker : "  ", role },
      { text, role },
    ],
  }));
  return { lines };
}

export function layoutTranscriptText(input: {
  text: string;
  marker: string;
  role: TerminalStyleRole;
  columns: number;
}): TerminalScene {
  return {
    lines: wrapTerminalProse(input.text, Math.max(24, input.columns - 2)).map((text, index) => ({
      spans: [
        { text: index === 0 ? input.marker : "  ", role: input.role },
        { text, role: input.role },
      ],
    })),
  };
}

export function layoutHeader(input: ChatViewportPresentation["header"]): TerminalScene {
  const meta = (text: string): Array<{ text: string; role: TerminalStyleRole }> => {
    const [key, ...rest] = text.split(" ");
    return rest.length === 0
      ? [{ text, role: "plain" }]
      : [
          { text: `${key} `, role: "muted" },
          { text: rest.join(" "), role: "plain" },
        ];
  };
  return {
    lines: [
      {
        spans: [
          { text: " ▗█████▖   ", role: "header-mascot" },
          { text: input.title, role: "header-brand" },
          ...(input.titleSuffix ? [{ text: input.titleSuffix, role: "header-brand" as const }] : []),
        ],
      },
      {
        spans: [
          { text: " ▟█ ", role: "header-mascot" },
          { text: "● ●", role: "header-eyes" },
          { text: " █▙  ", role: "header-mascot" },
          ...meta(`version ${input.version}`),
        ],
      },
      { spans: [{ text: " ▜█▄▄▄▄▄█▛  ", role: "header-mascot" }, ...meta(`session ${input.sessionId}`)] },
    ],
  };
}

export function layoutPending(input: {
  presentation: PendingPresentation;
  now: number;
  columns: number;
}): TerminalScene {
  const { presentation } = input;
  const elapsed =
    presentation.state.kind === "running" && presentation.startedAt !== null
      ? Math.max(0, Math.floor((input.now - presentation.startedAt) / 1000))
      : 0;
  const tokenText = presentation.runningUsage
    ? t("unit.token.arrows", {
        input: formatCompactNumber(presentation.runningUsage.inputTokens),
        output: formatCompactNumber(presentation.runningUsage.outputTokens),
      })
    : "";
  const text =
    presentation.state.kind === "running"
      ? `${t("agent.status.working")} (${[elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`, presentation.state.toolCalls ? t("unit.tool", { count: presentation.state.toolCalls }) : "", tokenText].filter(Boolean).join(" · ")})`
      : presentation.state.kind === "queued"
        ? typeof presentation.state.position === "number"
          ? t("rpc.status.queued", { position: presentation.state.position })
          : t("rpc.status.queued.unknown")
        : t("rpc.status.accepted");
  const blink = presentation.state.kind !== "running" || Math.abs(presentation.frame) % 16 < 8;
  const role: TerminalStyleRole =
    presentation.state.kind === "running"
      ? "pending-shimmer"
      : presentation.state.kind === "queued"
        ? "queued"
        : "pending";
  const lines: TerminalLine[] = wrapTerminalProse(text, Math.max(24, input.columns - 2)).map((line, index) => ({
    spans: [
      { text: index === 0 ? `${blink ? "•" : " "} ` : "  ", role },
      { text: line, role },
    ],
  }));
  for (const message of presentation.queuedMessages)
    lines.push(
      ...wrapTerminalProse(message, Math.max(24, input.columns - 2)).map((line, index) => ({
        spans: [
          { text: index === 0 ? "❯ " : "  ", role: "muted" as const },
          { text: line, role: "muted" as const },
        ],
      })),
    );
  return { lines };
}

export function layoutTranscriptChecklist(output: ChecklistOutput): TerminalScene {
  const formatted = formatChecklist(output);
  return {
    lines: [
      { spans: [{ text: formatted.header, role: "tool-label" }] },
      ...formatted.items.map((item) => ({
        spans: [{ text: `  ${item.marker} ${item.label}`, role: "muted" as const }],
      })),
    ],
  };
}

function toolRole(role: string): TerminalStyleRole | null {
  if (role === "label") return "tool-label";
  if (role === "meta-add") return "tool-meta-add";
  if (role === "meta-remove") return "tool-meta-remove";
  if (role === "diff-text") return "plain";
  if (role === "stream-tag") return null;
  return "muted";
}

export function layoutTranscriptTool(input: {
  parts: ToolOutputPart[];
  lifecycle: "complete" | "active" | "pending" | "queued" | "success" | "warning" | "error" | "cancelled";
  columns: number;
}): TerminalScene {
  const contentWidth = Math.max(24, input.columns - 2);
  const marker = input.lifecycle === "success" ? "◉ " : input.lifecycle === "cancelled" ? "○ " : "• ";
  return {
    lines: layoutToolOutput(input.parts).map((line, index) => {
      const fitted = fitLine(
        { ...line, segments: line.segments.filter((segment) => segment.role !== "stream-tag") },
        contentWidth,
      );
      const fill =
        fitted.fill === "diff-add" ? "diff-added" : fitted.fill === "diff-remove" ? "diff-removed" : undefined;
      const spans = fitted.segments.flatMap((segment) => {
        const role = toolRole(segment.role);
        return role ? [{ text: segment.text, role: segment.role === "diff-text" && fill ? fill : role }] : [];
      });
      const padding = fill
        ? " ".repeat(Math.max(0, contentWidth - fitted.indent - segmentsWidth(fitted.segments)))
        : "";
      return {
        fill,
        spans: [
          { text: index === 0 ? marker : " ".repeat(fitted.indent + 2), role: "tool" as const },
          ...spans,
          ...(padding ? [{ text: padding, role: "plain" as const }] : []),
        ],
      };
    }),
  };
}

export function layoutChatViewport(input: {
  presentation: ChatViewportPresentation;
  constraints: TerminalConstraints;
  theme: TerminalTheme;
  now: number;
}): TerminalScene {
  void input.theme;
  void input.now;
  const lines: TerminalLine[] = [];
  const sections: NonNullable<TerminalScene["sections"]> = [];
  const append = (id: string, finalized: boolean, scene: TerminalScene): void => {
    const lineStart = lines.length;
    lines.push(...scene.lines);
    sections.push({ id, lineStart, lineEnd: lines.length, finalized });
  };
  append("header", true, layoutHeader(input.presentation.header));
  for (const row of input.presentation.transcript) {
    if (row.content.kind === "checklist") continue;
    if (row.content.kind === "tool-output") {
      append(
        row.id,
        row.lifecycle !== "active",
        layoutTranscriptTool({
          parts: row.content.output.parts,
          lifecycle: row.lifecycle,
          columns: input.constraints.columns,
        }),
      );
    } else if (row.content.kind === "command-output") {
      const body = formatCommandOutput(row.content.output);
      append(
        row.id,
        true,
        layoutTranscriptText({
          text: body ? `${row.content.output.header}\n\n${body}` : row.content.output.header,
          marker: row.kind === "system" ? "  " : "• ",
          role: row.kind === "system" ? "muted" : "plain",
          columns: input.constraints.columns,
        }),
      );
    } else if (row.kind === "user" || row.kind === "assistant") {
      append(
        row.id,
        row.lifecycle !== "active",
        layoutTranscriptMessage({ text: row.content.text, kind: row.kind, columns: input.constraints.columns }),
      );
    } else {
      append(
        row.id,
        true,
        layoutTranscriptText({
          text: row.content.text,
          marker: row.kind === "system" ? "  " : "• ",
          role: row.kind === "system" ? "muted" : "plain",
          columns: input.constraints.columns,
        }),
      );
    }
  }
  const checklists = input.presentation.transcript.filter((row) => row.content.kind === "checklist");
  if (checklists.length > 0)
    append("checklist", false, {
      lines: checklists.flatMap(
        (row) => layoutTranscriptChecklist((row.content as { output: ChecklistOutput }).output).lines,
      ),
    });
  if (input.presentation.pending)
    append(
      "pending",
      false,
      layoutPending({ presentation: input.presentation.pending, now: input.now, columns: input.constraints.columns }),
    );
  const composer = layoutComposer(
    {
      text: input.presentation.composer.input.text,
      cursor: input.presentation.composer.input.cursor,
      placeholder: input.presentation.composer.placeholder,
    },
    input.constraints,
  );
  const composerStart = lines.length;
  lines.push(...composer.lines);
  const status = input.presentation.composer.status;
  if (status.length > 0) {
    const text = status.map((segment) => segment.text).join("");
    lines.push({ spans: [{ text, role: "muted" }] });
  }
  sections.push({ id: "composer", lineStart: composerStart, lineEnd: lines.length, finalized: false });
  return { lines, sections, cursor: { ...composer.cursor, row: composer.cursor.row + composerStart } };
}
export { truncate as truncateTerminalText };
