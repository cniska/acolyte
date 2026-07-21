import { z } from "zod";
import { formatCommandOutput, formatCompactNumber } from "./chat-format";
import type { TranscriptStatus } from "./chat-transcript-contract";
import type { ChatViewportPresentation, PendingPresentation } from "./chat-viewport-contract";
import type { ChecklistOutput } from "./checklist-contract";
import { formatChecklist } from "./checklist-format";
import { t } from "./i18n";
import type { TerminalLine, TerminalScene } from "./terminal-scene-contract";
import type { TerminalStyleRole, TerminalTheme } from "./terminal-theme";
import type { ToolOutputPart } from "./tool-output-contract";
import { fitLine, layoutToolOutput, segmentsWidth } from "./tool-output-layout";

export const terminalConstraintsSchema = z.object({
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type TerminalConstraints = z.infer<typeof terminalConstraintsSchema>;

function width(text: string): number {
  return Bun.stringWidth(text);
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
  markerRole: TerminalStyleRole;
  textRole: TerminalStyleRole;
  columns: number;
}): TerminalScene {
  return {
    lines: wrapTerminalProse(input.text, Math.max(24, input.columns - 2)).map((text, index) => ({
      spans: [
        { text: index === 0 ? input.marker : "  ", role: input.markerRole },
        { text, role: input.textRole },
      ],
    })),
  };
}

export function transcriptOutcomeRole(status: TranscriptStatus): TerminalStyleRole {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    case "warning":
      return "warning";
    default:
      return "muted";
  }
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

export function layoutComposerStatus(input: {
  presentation: ChatViewportPresentation["composer"];
  constraints: TerminalConstraints;
}): TerminalScene {
  const { presentation, constraints } = input;
  const terminalWidth = Math.max(24, constraints.columns);
  const border = (): TerminalLine => ({ spans: [{ text: "─".repeat(terminalWidth), role: "composer-border" }] });
  if (presentation.picker) {
    const picker = presentation.picker;
    const label =
      picker.kind === "model" ? `Model: ${picker.query}` : picker.kind === "skills" ? "Skills:" : "Sessions:";
    const items = picker.items.slice(picker.scrollOffset, picker.scrollOffset + 8);
    return {
      lines: [
        border(),
        { spans: [{ text: label, role: "plain" }] },
        { spans: [{ text: "", role: "plain" }] },
        ...items.map((item, index) => ({
          spans: [
            {
              text: `${picker.scrollOffset + index === picker.selected ? "›" : " "} ${item.label}`,
              role: picker.scrollOffset + index === picker.selected ? ("composer-prompt" as const) : ("plain" as const),
            },
          ],
        })),
        { spans: [{ text: "", role: "plain" }] },
        { spans: [{ text: picker.hint, role: "muted" }] },
        border(),
      ],
      cursor: { row: 1, column: width(label) },
    };
  }
  const text = presentation.input.text || presentation.placeholder;
  const promptLines = wrapTerminalProse(text, terminalWidth - 2);
  const lines: TerminalLine[] = [border()];
  lines.push(
    ...promptLines.map((line, index) => ({
      spans: [
        { text: index === 0 ? "❯ " : "  ", role: "composer-prompt" as const },
        { text: line, role: presentation.input.text ? ("plain" as const) : ("muted" as const) },
      ],
    })),
  );
  lines.push(border());
  if (presentation.showHelp) {
    const columns = terminalWidth >= presentation.helpBreakpoint ? 2 : 1;
    for (let index = 0; index < presentation.helpEntries.length; index += columns) {
      lines.push({
        spans: presentation.helpEntries.slice(index, index + columns).flatMap((entry) => [
          { text: `  ${entry.key.padEnd(20)}`, role: "muted" as const },
          { text: entry.description, role: "muted" as const },
        ]),
      });
    }
  } else if (presentation.suggestions.kind === "at") {
    const selected = presentation.suggestions.selected;
    if (presentation.suggestions.noMatches) lines.push({ spans: [{ text: " No matches.", role: "muted" }] });
    else
      lines.push(
        ...presentation.suggestions.candidates.map((candidate, index) => ({
          spans: [
            {
              text: `  ${candidate.label}`,
              role: index === selected ? ("composer-prompt" as const) : ("plain" as const),
            },
          ],
        })),
      );
  } else if (presentation.suggestions.kind === "slash") {
    const selected = presentation.suggestions.selected;
    lines.push(
      ...presentation.suggestions.candidates.map((candidate, index) => ({
        spans: [
          {
            text: `  ${candidate.command}`,
            role: index === selected ? ("composer-prompt" as const) : ("muted" as const),
          },
        ],
      })),
    );
    if (presentation.suggestions.selectedHelp)
      lines.push({ spans: [{ text: `\n  ${presentation.suggestions.selectedHelp}`, role: "muted" }] });
  }
  if (!presentation.showHelp && presentation.suggestions.kind === "none" && presentation.status.length > 0)
    lines.push({
      spans: presentation.status.map((segment) => ({
        text: segment.text,
        role:
          segment.role === "plain"
            ? ("plain" as const)
            : segment.role === "success"
              ? ("success" as const)
              : segment.role === "warning"
                ? ("warning" as const)
                : segment.role === "error"
                  ? ("error" as const)
                  : ("muted" as const),
      })),
    });
  const before = presentation.input.text.slice(0, presentation.input.cursor);
  const cursorLine = wrapTerminalProse(before, terminalWidth - 2).length - 1;
  return {
    lines,
    cursor: { row: cursorLine + 1, column: 2 + width(wrapTerminalProse(before, terminalWidth - 2).at(-1) ?? "") },
  };
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

function toolMarkerRole(status: TranscriptStatus): TerminalStyleRole {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "tool";
  }
}

export function layoutTranscriptTool(input: {
  parts: ToolOutputPart[];
  status: TranscriptStatus;
  columns: number;
}): TerminalScene {
  const contentWidth = Math.max(24, input.columns - 2);
  const markerRole = toolMarkerRole(input.status);
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
          { text: index === 0 ? "• " : " ".repeat(fitted.indent + 2), role: markerRole },
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
        row.status !== "active",
        layoutTranscriptTool({
          parts: row.content.output.parts,
          status: row.status,
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
          markerRole: row.kind === "system" ? "muted" : "plain",
          textRole: row.kind === "system" ? "muted" : "plain",
          columns: input.constraints.columns,
        }),
      );
    } else if (row.kind === "user" || row.kind === "assistant") {
      append(
        row.id,
        row.status !== "active",
        layoutTranscriptMessage({ text: row.content.text, kind: row.kind, columns: input.constraints.columns }),
      );
    } else {
      append(
        row.id,
        true,
        layoutTranscriptText({
          text: row.content.text,
          marker: row.kind === "system" ? "  " : "• ",
          markerRole: row.kind === "system" ? "muted" : transcriptOutcomeRole(row.status),
          textRole: "muted",
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
  const composer = layoutComposerStatus({ presentation: input.presentation.composer, constraints: input.constraints });
  const composerStart = lines.length;
  lines.push(...composer.lines);
  const status = input.presentation.composer.status;
  if (status.length > 0) {
    const text = status.map((segment) => segment.text).join("");
    lines.push({ spans: [{ text, role: "muted" }] });
  }
  sections.push({ id: "composer", lineStart: composerStart, lineEnd: lines.length, finalized: false });
  const cursor = composer.cursor ?? { row: 0, column: 0 };
  return { lines, sections, cursor: { ...cursor, row: cursor.row + composerStart } };
}
