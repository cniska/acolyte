import { z } from "zod";
import { sanitizeAssistantContent, tokenize, wrapAssistantContent } from "./chat-content";
import { formatCommandOutput, formatCompactNumber } from "./chat-format";
import type { TranscriptStatus } from "./chat-transcript-contract";
import type { ChatViewportPresentation, PendingPresentation } from "./chat-viewport-contract";
import type { ChecklistOutput } from "./checklist-contract";
import { formatChecklist } from "./checklist-format";
import { formatRelativeTime } from "./datetime";
import type { FooterStatus } from "./footer-status-contract";
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
  if (input.kind === "assistant") {
    const contentWidth = Math.max(24, input.columns - 2);
    return {
      lines: wrapAssistantContent(sanitizeAssistantContent(input.text), contentWidth)
        .split("\n")
        .map((line, index) => ({
          spans: [
            { text: index === 0 ? marker : "  ", role },
            ...tokenize(line).map((token) => ({
              text:
                token.kind === "code"
                  ? token.text.slice(1, -1)
                  : token.kind === "bold"
                    ? token.text.slice(2, -2)
                    : token.text,
              role:
                token.kind === "code"
                  ? ("assistant-code" as const)
                  : token.kind === "bold"
                    ? ("assistant-bold" as const)
                    : token.kind === "path"
                      ? ("assistant-path" as const)
                      : role,
            })),
          ],
        })),
    };
  }
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
          { text: "   ▗█████▖   ", role: "header-mascot" },
          { text: input.title, role: "header-brand" },
          ...(input.titleSuffix ? [{ text: input.titleSuffix, role: "header-brand" as const }] : []),
        ],
      },
      {
        spans: [
          { text: "  ▟█ ", role: "header-mascot" },
          { text: "● ●", role: "header-eyes" },
          { text: " █▙  ", role: "header-mascot" },
          ...meta(`version ${input.version}`),
        ],
      },
      { spans: [{ text: "  ▜█▄▄▄▄▄█▛  ", role: "header-mascot" }, ...meta(`session ${input.sessionId}`)] },
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
  for (const message of presentation.queuedMessages) {
    lines.push({ spans: [{ text: "", role: "plain" }] });
    lines.push(
      ...wrapTerminalProse(message, Math.max(24, input.columns - 2)).map((line, index) => ({
        spans: [
          { text: index === 0 ? "❯ " : "  ", role: "muted" as const },
          { text: line, role: "muted" as const },
        ],
      })),
    );
  }
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
      picker.kind === "model"
        ? `Model: ${picker.input.text}`
        : picker.kind === "skills"
          ? t("chat.picker.title.skills")
          : t("chat.picker.title.resume");
    const items = picker.items.slice(picker.scrollOffset, picker.scrollOffset + 8);
    const pickerItems =
      picker.kind === "model" && picker.loading
        ? [{ spans: [{ text: `  ${t("chat.picker.loading")}`, role: "muted" as const }] }]
        : items.map((item, index) => {
            const detail = item.detail
              ? picker.kind === "sessions"
                ? `  ${formatRelativeTime(item.detail)}`
                : ` ${item.detail}`
              : "";
            const identity = picker.kind === "sessions" ? `${item.active ? "●" : " "} ${item.value}  ` : "";
            const label = picker.kind === "skills" ? item.label.padEnd(20) : item.label;
            return {
              spans: [
                {
                  text: `${picker.scrollOffset + index === picker.selected ? "›" : " "} ${identity}${label}${detail}`,
                  role:
                    picker.scrollOffset + index === picker.selected ? ("composer-prompt" as const) : ("plain" as const),
                },
              ],
            };
          });
    return {
      lines: [
        border(),
        { spans: [{ text: label, role: "plain" }] },
        { spans: [{ text: "", role: "plain" }] },
        ...pickerItems,
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
    const rowsPerColumn =
      columns === 2 ? Math.ceil(presentation.helpEntries.length / 2) : presentation.helpEntries.length;
    for (let row = 0; row < rowsPerColumn; row++) {
      const entries = [
        presentation.helpEntries[row],
        columns === 2 ? presentation.helpEntries[row + rowsPerColumn] : undefined,
      ];
      lines.push({
        spans: entries.flatMap((entry) =>
          entry ? [{ text: `  ${entry.key.padEnd(20)}${entry.description}`.padEnd(44), role: "muted" as const }] : [],
        ),
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
  if (!presentation.showHelp && presentation.suggestions.kind === "none" && presentation.ctrlCPending)
    lines.push({ spans: [{ text: `  ${t("chat.input.ctrl_c_hint")}`, role: "muted" }] });
  const before = presentation.input.text.slice(0, presentation.input.cursor);
  const cursorLine = wrapTerminalProse(before, terminalWidth - 2).length - 1;
  return {
    lines,
    cursor: { row: cursorLine + 1, column: 2 + width(wrapTerminalProse(before, terminalWidth - 2).at(-1) ?? "") },
  };
}

export function layoutFooterStatus(status: FooterStatus, columns: number): TerminalScene {
  const names: string[] = [];
  for (const name of [status.repo, status.worktree, status.branch]) {
    if (name && !names.includes(name)) names.push(name);
  }
  const suffix = `${status.dirty ? "*" : ""}${status.ahead ? ` ↑${status.ahead}` : ""}${status.behind ? ` ↓${status.behind}` : ""}`;
  const location = names.map((name) => `${name}${name === status.branch ? suffix : ""}`);
  const model = `${status.model}${status.effort ? ` ${status.effort}` : ""}`;
  const usage =
    status.inputTokens || status.outputTokens
      ? t("unit.token.arrows", {
          input: formatCompactNumber(status.inputTokens),
          output: formatCompactNumber(status.outputTokens),
        })
      : null;
  const pr = status.pr ? `PR #${status.pr.number}` : null;
  const text = [...location, model, usage, pr].filter((part): part is string => Boolean(part)).join(" · ");
  const skills = status.skills.length > 0 ? `  ${status.skills.join(" · ")}` : "";
  return {
    lines: wrapTerminalProse(`${text}${skills}`, Math.max(22, columns - 2)).map((line) => ({
      spans: [{ text: `  ${line}`, role: "muted" }],
    })),
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
  const headerState = input.parts.find((part) => part.kind === "tool-header")?.state;
  const marker = headerState === "on" ? "◉ " : headerState === "off" ? "○ " : "• ";
  const markerRole = headerState === "on" ? "tool" : headerState === "off" ? "muted" : toolMarkerRole(input.status);
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
          { text: index === 0 ? marker : " ".repeat(fitted.indent + 2), role: markerRole },
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
    if (lines.length > 0) lines.push({ spans: [{ text: "", role: "plain" }] });
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
  if (input.presentation.pending)
    append(
      "pending",
      false,
      layoutPending({ presentation: input.presentation.pending, now: input.now, columns: input.constraints.columns }),
    );
  for (const row of input.presentation.transcript) {
    if (row.content.kind !== "checklist") continue;
    const checklist = layoutTranscriptChecklist((row.content as { output: ChecklistOutput }).output);
    append(row.id, false, {
      lines: checklist.lines.map((line) => ({
        ...line,
        spans: [{ text: "  ", role: "plain" as const }, ...line.spans],
      })),
    });
  }
  const composer = layoutComposerStatus({
    presentation: input.presentation.composer,
    constraints: input.constraints,
  });
  if (lines.length > 0) lines.push({ spans: [{ text: "", role: "plain" }] });
  const composerStart = lines.length;
  lines.push(...composer.lines);
  if (
    input.presentation.footer &&
    !input.presentation.composer.showHelp &&
    input.presentation.composer.suggestions.kind === "none" &&
    !input.presentation.composer.picker &&
    !input.presentation.composer.ctrlCPending
  )
    lines.push(...layoutFooterStatus(input.presentation.footer, input.constraints.columns).lines);
  sections.push({ id: "composer", lineStart: composerStart, lineEnd: lines.length, finalized: false });
  const cursor = composer.cursor ?? { row: 0, column: 0 };
  return { lines, sections, cursor: { ...cursor, row: cursor.row + composerStart } };
}
