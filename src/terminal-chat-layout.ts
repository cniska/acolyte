import { z } from "zod";
import { unreachable } from "./assert";
import {
  type MarkupToken,
  sanitizeAssistantContent,
  segmentAssistantContent,
  tokenize,
  wrapAssistantContent,
} from "./chat-content";
import { alignCols, formatCommandOutput, formatCompactNumber } from "./chat-format";
import { GLYPH_FILLED, GLYPH_FISHEYE, GLYPH_HOLLOW, GLYPH_USER } from "./chat-glyphs";
import { PICKER_LABEL_WIDTH, PICKER_PAGE_SIZE } from "./chat-picker";
import type { TranscriptStatus } from "./chat-transcript-contract";
import type { ChatViewportPresentation, PendingPresentation } from "./chat-viewport-contract";
import { highlightCode } from "./code-highlight";
import { formatRelativeTime } from "./datetime";
import type { FooterStatus } from "./footer-status-contract";
import type { PrState } from "./gh-contract";
import { t } from "./i18n";
import { buildPromptDisplayLines } from "./prompt-display";
import { type TasklistItemStatus, type TasklistOutput, tasklistMarker, tasklistProgress } from "./tasklist-contract";
import type { TerminalLine, TerminalScene, TerminalSpan } from "./terminal-scene-contract";
import type { TerminalStyleRole, TerminalTheme } from "./terminal-theme";
import type { ToolHeaderState, ToolOutputPart } from "./tool-output-contract";
import { fitLine, layoutToolOutput, segmentsWidth } from "./tool-output-layout";
import { truncateToWidth } from "./truncate-text";

export const terminalConstraintsSchema = z.object({
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type TerminalConstraints = z.infer<typeof terminalConstraintsSchema>;

function width(text: string): number {
  return Bun.stringWidth(text);
}

const codeGraphemes = new Intl.Segmenter();

// Hard-wraps highlighted code spans to a display-width budget, breaking at the last grapheme that
// fits — no word wrap, no truncation, because code is read and copied. Pure geometry: measures
// display cells (Bun.stringWidth), takes a budget not physical columns. A blank line yields one
// empty row. Shares its break rule with chat-content's wrapCodeText (the colorless CLI path); the
// equivalence is pinned by a test so the two never drift.
export function wrapSpans(spans: TerminalSpan[], budget: number): TerminalSpan[][] {
  const limit = Math.max(1, budget);
  const rows: TerminalSpan[][] = [];
  let row: TerminalSpan[] = [];
  let used = 0;
  for (const span of spans) {
    let chunk = "";
    for (const { segment } of codeGraphemes.segment(span.text)) {
      const cell = width(segment);
      if (used > 0 && used + cell > limit) {
        if (chunk.length > 0) row.push({ text: chunk, role: span.role });
        chunk = "";
        rows.push(row);
        row = [];
        used = 0;
      }
      chunk += segment;
      used += cell;
    }
    if (chunk.length > 0) row.push({ text: chunk, role: span.role });
  }
  rows.push(row);
  return rows;
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

const GUTTER = 1;
const BOX_BORDER = 1;
const BOX_PAD = 1;
// The column where content begins: transcript rows inset by the box's border+pad thickness so
// their glyphs align with the boxed composer prompt, even though only the composer draws a frame.
const CONTENT_COLUMN = GUTTER + BOX_BORDER + BOX_PAD;
function contentWidth(columns: number): number {
  return Math.max(24, columns - 2 * CONTENT_COLUMN);
}
// The one wrap width for composer input. The input handler resolves visual up/down motion against
// this same value, so its line math can never disagree with what the box renders.
export function promptWrapWidth(columns: number): number {
  return contentWidth(Math.max(24, columns)) - 2;
}
function insetScene(scene: TerminalScene, left: number): TerminalScene {
  const pad = " ".repeat(left);
  return {
    ...scene,
    lines: scene.lines.map((line) =>
      line.spans.every((span) => span.text.length === 0)
        ? line
        : { ...line, spans: [{ text: pad, role: "plain" as const }, ...line.spans] },
    ),
    cursor: scene.cursor ? { ...scene.cursor, column: scene.cursor.column + left } : undefined,
  };
}

function assistantTokenSpan(token: MarkupToken, role: TerminalStyleRole): TerminalSpan {
  switch (token.kind) {
    case "code":
      return { text: token.text.slice(1, -1), role: "assistant-code" };
    case "bold":
      return { text: token.text.slice(2, -2), role: "assistant-bold" };
    case "path":
      return { text: token.text, role: "assistant-path" };
    default:
      return { text: token.text, role };
  }
}

function lineWidth(line: TerminalLine): number {
  return line.spans.reduce((total, span) => total + width(span.text), 0);
}

// The inline completion preview: the remainder of the selected suggestion when it extends what is
// typed. Only a prefix match ghosts — a fuzzy match (`/he` → `/new`) has no coherent continuation,
// so nothing shows and the candidate list carries it instead. Requires a non-empty typed fragment
// past the trigger: a bare `/` or `@` guesses too early (and would pin the caret on the trigger).
function composerGhost(presentation: ChatViewportPresentation["composer"]): string {
  if (presentation.input.cursor !== presentation.input.text.length) return "";
  const suggestions = presentation.suggestions;
  if (suggestions.kind === "slash") {
    const typed = presentation.input.text;
    if (typed.length < 2) return "";
    const command = suggestions.candidates[suggestions.selected]?.command ?? "";
    return command.startsWith(typed) ? command.slice(typed.length) : "";
  }
  if (suggestions.kind === "at") {
    if (suggestions.query.length === 0) return "";
    const value = suggestions.candidates[suggestions.selected]?.value ?? "";
    return value.startsWith(suggestions.query) ? value.slice(suggestions.query.length) : "";
  }
  return "";
}

// Interior rows are padded to the content width so the right border is column-stable, and the
// interior cursor is translated by the same constant that draws the padding, so they cannot drift.
function frameScene(interior: TerminalScene, columns: number): TerminalScene {
  const inner = contentWidth(columns);
  const gutter = " ".repeat(GUTTER);
  const rule = "─".repeat(Math.max(0, columns - 2 * GUTTER - 2));
  const horizontal = (left: string, right: string): TerminalLine => ({
    spans: [
      { text: gutter, role: "plain" },
      { text: `${left}${rule}${right}`, role: "composer-border" },
    ],
  });
  const frame = (line: TerminalLine): TerminalLine => {
    const pad = Math.max(0, inner - lineWidth(line));
    return {
      ...line,
      spans: [
        { text: gutter, role: "plain" },
        { text: "│", role: "composer-border" },
        { text: " ".repeat(BOX_PAD), role: "plain" },
        ...line.spans,
        ...(pad > 0 ? [{ text: " ".repeat(pad), role: "plain" as const }] : []),
        { text: " ".repeat(BOX_PAD), role: "plain" },
        { text: "│", role: "composer-border" },
      ],
    };
  };
  return {
    lines: [horizontal("╭", "╮"), ...interior.lines.map(frame), horizontal("╰", "╯")],
    cursor: interior.cursor
      ? { row: interior.cursor.row + 1, column: interior.cursor.column + CONTENT_COLUMN }
      : undefined,
  };
}

export function layoutTranscriptMessage(input: {
  text: string;
  kind: "user" | "assistant";
  columns: number;
}): TerminalScene {
  const marker = input.kind === "user" ? `${GLYPH_USER} ` : `${GLYPH_FILLED} `;
  const role = input.kind;
  if (input.kind === "assistant") {
    const textWrap = Math.max(1, contentWidth(input.columns) - width(marker));
    const contentLines: TerminalSpan[][] = [];
    // Segments alternate prose/code, so a blank line before every segment but the first sets a
    // code block off from surrounding prose — the visual separator, since fence markers are stripped.
    segmentAssistantContent(input.text).forEach((segment, index) => {
      if (index > 0) contentLines.push([]);
      if (segment.kind === "prose") {
        for (const line of wrapAssistantContent(sanitizeAssistantContent(segment.text), textWrap).split("\n")) {
          contentLines.push(tokenize(line).map((token) => assistantTokenSpan(token, role)));
        }
      } else {
        for (const line of highlightCode(segment.text, segment.lang)) {
          for (const wrapped of wrapSpans(line, textWrap)) {
            contentLines.push(wrapped);
          }
        }
      }
    });
    return {
      lines: contentLines.map((spans, index) => ({
        spans: [{ text: index === 0 ? marker : "  ", role }, ...spans],
      })),
    };
  }
  // The band bleeds the full terminal width while the text sits at the content column, mirroring the
  // demo's negative-margin trick. Leading whitespace carries the user-fill role so its own background
  // paints the left gutter — the renderer's `fill` only reaches from the first non-blank span rightward.
  const bandLine = (): TerminalLine => ({ spans: [{ text: " ".repeat(input.columns), role: "user-fill" as const }] });
  const textLines: TerminalLine[] = wrapTerminalProse(
    input.text,
    Math.max(1, contentWidth(input.columns) - width(marker)),
  ).map((text, index) => {
    const lead =
      index === 0
        ? [
            { text: " ".repeat(CONTENT_COLUMN), role: "user-fill" as const },
            { text: marker, role },
          ]
        : [{ text: " ".repeat(CONTENT_COLUMN + width(marker)), role: "user-fill" as const }];
    const pad = Math.max(0, input.columns - CONTENT_COLUMN - width(marker) - width(text));
    return {
      fill: "user-fill" as const,
      spans: [...lead, { text, role }, ...(pad ? [{ text: " ".repeat(pad), role: "plain" as const }] : [])],
    };
  });
  return { lines: [bandLine(), ...textLines, bandLine()] };
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

const PENDING_FRAME_COUNT = 16;
const SHIMMER_SWEEP = 12;

function shimmerRole(distance: number): TerminalStyleRole {
  if (distance < SHIMMER_SWEEP / 3) return "pending-shimmer-bright";
  if (distance < (SHIMMER_SWEEP * 2) / 3) return "pending-shimmer-mid";
  return "pending-shimmer";
}

function shimmerSpans(text: string, offset: number, sweepPos: number): TerminalSpan[] {
  const spans: TerminalSpan[] = [];
  for (const [index, char] of [...text].entries()) {
    const role = shimmerRole(Math.abs(offset + index - sweepPos));
    const last = spans.at(-1);
    if (last && last.role === role) last.text += char;
    else spans.push({ text: char, role });
  }
  return spans;
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
  const running = presentation.state.kind === "running";
  const blink = !running || Math.abs(presentation.frame) % PENDING_FRAME_COUNT < PENDING_FRAME_COUNT / 2;
  // Marker carries the kind color, the text a shimmer sweep (running) or dim (queued/accepted).
  const markerRole: TerminalStyleRole = running
    ? "pending"
    : presentation.state.kind === "queued"
      ? "queued"
      : "accepted";
  const range = text.length + SHIMMER_SWEEP * 2;
  const sweepPos = ((Math.abs(presentation.frame) % PENDING_FRAME_COUNT) / PENDING_FRAME_COUNT) * range - SHIMMER_SWEEP;
  let shimmerOffset = 0;
  const lines: TerminalLine[] = wrapTerminalProse(text, Math.max(24, input.columns - 2)).map((line, index) => {
    const marker: TerminalSpan = {
      text: index === 0 ? `${blink ? GLYPH_FILLED : GLYPH_HOLLOW} ` : "  ",
      role: markerRole,
    };
    const body: TerminalSpan[] = running
      ? shimmerSpans(line, shimmerOffset, sweepPos)
      : [{ text: line, role: "muted" }];
    shimmerOffset += line.length;
    return { spans: [marker, ...body] };
  });
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
  const cw = contentWidth(terminalWidth);
  if (presentation.picker) {
    const picker = presentation.picker;
    let labelLine: TerminalLine;
    let labelColumn: number;
    if (picker.kind === "model") {
      const modelPrefix = `${t("chat.picker.label.model")} `;
      // Reserve one column for the trailing caret so the label can never outgrow the box interior.
      const query = truncateToWidth(picker.input.text, Math.max(1, cw - width(modelPrefix) - 1));
      const caret = Math.max(0, Math.min(picker.input.cursor, query.length));
      labelLine = {
        spans: [
          { text: modelPrefix, role: "plain" },
          { text: query.slice(0, caret), role: "muted" },
          { text: query[caret] ?? " ", role: presentation.caretVisible ? "cursor" : "muted" },
          { text: query.slice(caret + 1), role: "muted" },
        ],
      };
      labelColumn = width(modelPrefix) + width(query.slice(0, caret));
    } else {
      const title = picker.kind === "skills" ? t("chat.picker.title.skills") : t("chat.picker.title.resume");
      labelLine = { spans: [{ text: title, role: "plain" }] };
      labelColumn = width(title);
    }
    const visible = picker.items.slice(picker.scrollOffset, picker.scrollOffset + PICKER_PAGE_SIZE);
    const selectedRel = picker.selected - picker.scrollOffset;
    const rowPrefix = (index: number): string => (index === selectedRel ? "› " : "  ");
    const rowRole = (index: number): TerminalStyleRole => (index === selectedRel ? "selected" : "plain");
    const row = (index: number, body: string): TerminalLine => ({
      spans: [{ text: truncateToWidth(`${rowPrefix(index)}${body}`, cw), role: rowRole(index) }],
    });
    let pickerItems: TerminalLine[];
    if (picker.kind === "model" && picker.loading) {
      pickerItems = [{ spans: [{ text: `  ${t("chat.picker.loading")}`, role: "muted" }] }];
    } else if (visible.length === 0) {
      pickerItems = [{ spans: [{ text: ` ${t("chat.picker.no_matches")}`, role: "muted" }] }];
    } else if (picker.kind === "sessions") {
      // alignCols across the full list (not just the visible slice), matching legacy, so a
      // long id or title in an off-screen row still lines up the visible rows' columns.
      const idCells = picker.items.map((item) => `${item.active ? GLYPH_FILLED : " "} ${item.value}`);
      const timeCells = picker.items.map((item) => (item.detail ? formatRelativeTime(item.detail) : ""));
      const idWidth = Math.max(0, ...idCells.map((cell) => cell.length));
      const timeWidth = Math.max(0, ...timeCells.map((cell) => cell.length));
      const titleBudget = Math.max(1, cw - 2 - idWidth - 2 - timeWidth - 2);
      const aligned = alignCols(
        picker.items.map((item, index) => [
          idCells[index] ?? "",
          truncateToWidth(item.label || t("chat.session.default_title"), titleBudget),
          timeCells[index] ?? "",
        ]),
      );
      pickerItems = aligned
        .slice(picker.scrollOffset, picker.scrollOffset + PICKER_PAGE_SIZE)
        .map((line, index) => row(index, line));
    } else if (picker.kind === "skills") {
      // Skills are not windowed (no scrollOffset); render the full list, as legacy did.
      pickerItems = picker.items.map((item, index) => {
        const label = truncateToWidth(item.label, PICKER_LABEL_WIDTH).padEnd(PICKER_LABEL_WIDTH);
        const detail = item.detail ?? "";
        if (index === selectedRel) return row(index, `${label} ${detail}`);
        return {
          spans: [
            { text: truncateToWidth(`  ${label}`, cw), role: "plain" as const },
            { text: truncateToWidth(` ${detail}`, Math.max(1, cw - 2 - PICKER_LABEL_WIDTH)), role: "muted" as const },
          ],
        };
      });
    } else {
      // Model rows have no column after the label, so padding would only add
      // trailing space the renderer trims; emit the label as-is.
      pickerItems = visible.map((item, index) => row(index, item.label));
    }
    return frameScene(
      {
        lines: [
          labelLine,
          { spans: [{ text: "", role: "plain" }] },
          ...pickerItems,
          { spans: [{ text: "", role: "plain" }] },
          { spans: [{ text: picker.hint, role: "muted" }] },
        ],
        cursor: { row: 0, column: labelColumn },
      },
      terminalWidth,
    );
  }
  const caretRole: TerminalStyleRole = presentation.caretVisible ? "cursor" : "plain";
  const ghost = composerGhost(presentation);
  const promptLines: TerminalLine[] = [];
  let caretRow = 0;
  let caretColumn = 2;
  if (presentation.input.text.length === 0) {
    promptLines.push({
      spans: [
        { text: "❯ ", role: "composer-prompt" },
        { text: " ", role: caretRole },
      ],
    });
  } else {
    const displayLines = buildPromptDisplayLines(
      presentation.input.text,
      presentation.input.cursor,
      promptWrapWidth(terminalWidth),
    );
    for (const [index, line] of displayLines.entries()) {
      if (line.cursor !== null) {
        caretRow = index;
        caretColumn = 2 + width(line.before);
      }
      const marker = { text: index === 0 ? "❯ " : "  ", role: "composer-prompt" as const };
      // The caret sits at the insertion point — on the ghost's first char (inverse) — and the rest
      // trails faint. Clip to the interior so a long candidate never pushes the line past the border.
      const ghostRoom = promptWrapWidth(terminalWidth) - width(line.before);
      const shownGhost =
        ghost && line.cursor !== null && line.after === "" ? ghost.slice(0, Math.max(0, ghostRoom)) : "";
      if (shownGhost) {
        promptLines.push({
          spans: [
            marker,
            { text: line.before, role: "plain" },
            { text: shownGhost.slice(0, 1), role: caretRole },
            { text: shownGhost.slice(1), role: "ghost" },
          ],
        });
        continue;
      }
      promptLines.push({
        spans: [
          marker,
          { text: line.before, role: "plain" },
          ...(line.cursor !== null ? [{ text: line.cursor, role: caretRole }] : []),
          { text: line.after, role: "plain" },
        ],
      });
    }
  }
  const boxed = frameScene({ lines: promptLines, cursor: { row: caretRow, column: caretColumn } }, terminalWidth);
  const attached: TerminalLine[] = [];
  if (presentation.showHelp) {
    const helpColumns = cw >= presentation.helpBreakpoint ? 2 : 1;
    const rowsPerColumn =
      helpColumns === 2 ? Math.ceil(presentation.helpEntries.length / 2) : presentation.helpEntries.length;
    for (let row = 0; row < rowsPerColumn; row++) {
      const entries = [
        presentation.helpEntries[row],
        helpColumns === 2 ? presentation.helpEntries[row + rowsPerColumn] : undefined,
      ];
      attached.push({
        spans: entries.flatMap((entry) =>
          entry
            ? [
                { text: `  ${entry.key.padEnd(20)}`, role: "plain" as const },
                { text: entry.description.padEnd(22), role: "muted" as const },
              ]
            : [],
        ),
      });
    }
  } else if (presentation.suggestions.kind === "at") {
    const selected = presentation.suggestions.selected;
    if (presentation.suggestions.noMatches) attached.push({ spans: [{ text: " No matches.", role: "muted" }] });
    else
      attached.push(
        ...presentation.suggestions.candidates.map((candidate, index) => ({
          spans: [
            {
              text: truncateToWidth(`  ${candidate.label}`, cw),
              role: index === selected ? ("selected" as const) : ("plain" as const),
            },
          ],
        })),
      );
  } else if (presentation.suggestions.kind === "slash") {
    const selected = presentation.suggestions.selected;
    // Each command carries its help in a dim column (like the skills picker), so the whole list
    // is legible at once instead of only the selected row's help on a line below.
    attached.push(
      ...presentation.suggestions.candidates.map((candidate, index) => {
        const label = truncateToWidth(candidate.command, PICKER_LABEL_WIDTH).padEnd(PICKER_LABEL_WIDTH);
        const help = candidate.help ?? "";
        if (index === selected)
          return { spans: [{ text: truncateToWidth(`  ${label} ${help}`, cw), role: "selected" as const }] };
        return {
          spans: [
            { text: `  ${label}`, role: "plain" as const },
            { text: truncateToWidth(` ${help}`, Math.max(1, cw - 2 - PICKER_LABEL_WIDTH)), role: "muted" as const },
          ],
        };
      }),
    );
  }
  if (!presentation.showHelp && presentation.suggestions.kind === "none" && presentation.ctrlCPending)
    attached.push({ spans: [{ text: t("chat.input.ctrl_c_hint"), role: "muted" }] });
  return {
    lines: [...boxed.lines, ...insetScene({ lines: attached }, CONTENT_COLUMN).lines],
    cursor: boxed.cursor,
  };
}

function prStateRole(state: PrState): TerminalStyleRole {
  switch (state) {
    case "open":
      return "pr-open";
    case "merged":
      return "pr-merged";
    case "closed":
      return "pr-closed";
    default:
      return unreachable(state);
  }
}

export function layoutFooterStatus(status: FooterStatus, columns: number): TerminalScene {
  const names: string[] = [];
  for (const name of [status.repo, status.worktree, status.branch]) {
    if (name && !names.includes(name)) names.push(name);
  }
  const suffix = `${status.dirty ? "*" : ""}${status.ahead ? ` ↑${status.ahead}` : ""}${status.behind ? ` ↓${status.behind}` : ""}`;
  // Two recessed gray tiers matching ~/.claude/statusline.sh (names/model brighter, the rest
  // faint); the PR number is the one state-colored accent, since a merged/closed PR on the branch
  // is actionable — its `PR` label stays faint like the other labels.
  const segments: TerminalSpan[] = [];
  const separate = (): void => {
    if (segments.length > 0) segments.push({ text: " · ", role: "faint" });
  };
  for (const name of names) {
    separate();
    segments.push({ text: name, role: "subtle" });
    if (name === status.branch && suffix) segments.push({ text: suffix, role: "faint" });
  }
  separate();
  segments.push({ text: status.model, role: "subtle" });
  if (status.effort) segments.push({ text: ` ${status.effort}`, role: "faint" });
  if (status.inputTokens || status.outputTokens) {
    separate();
    segments.push({
      text: t("unit.token.arrows", {
        input: formatCompactNumber(status.inputTokens),
        output: formatCompactNumber(status.outputTokens),
      }),
      role: "faint",
    });
  }
  if (status.pr) {
    separate();
    segments.push({ text: "PR ", role: "faint" });
    segments.push({ text: `#${status.pr.number}`, role: prStateRole(status.pr.state) });
  }
  const text = segments.map((segment) => segment.text).join("");
  const statusWidth = width(text);
  if (status.skills.length === 0) {
    if (statusWidth <= columns) return { lines: [{ spans: segments }] };
    return {
      lines: wrapTerminalProse(text, columns).map((line) => ({
        spans: [{ text: line, role: "faint" as const }],
      })),
    };
  }
  const skillSegment = status.skills.join(" · ");
  // Skills sit right-justified on the status row, and stack onto their own row once they no longer fit.
  if (statusWidth + 2 + width(skillSegment) <= columns) {
    const gap = columns - statusWidth - width(skillSegment);
    return { lines: [{ spans: [...segments, { text: `${" ".repeat(gap)}${skillSegment}`, role: "faint" }] }] };
  }
  return {
    lines: [{ spans: segments }, { spans: [{ text: truncateToWidth(skillSegment, columns), role: "faint" }] }],
  };
}

const TASKLIST_VISIBLE_LIMIT = 5;
const TASKLIST_PULSE_MS = 500;

function taskItemRole(status: TasklistItemStatus): TerminalStyleRole {
  switch (status) {
    case "done":
      return "success";
    case "failed":
      return "error";
    default:
      return "faint";
  }
}

// Gentle glyph pulse for the active item, not a brightness blink (which pulls focus off the transcript).
function taskItemGlyph(status: TasklistItemStatus, pulseFilled: boolean): string {
  if (status === "in_progress") return pulseFilled ? GLYPH_FISHEYE : GLYPH_HOLLOW;
  return tasklistMarker(status);
}

// Display-only bounded view: the semantic tasklist keeps every item; done collapses into the count.
export function layoutTranscriptTasklist(output: TasklistOutput, contentWidth: number, now: number): TerminalScene {
  const sorted = [...output.items].sort((a, b) => a.order - b.order);
  const { done, total } = tasklistProgress(sorted);
  const notDone = sorted.filter((item) => item.status !== "done");
  const visible = notDone.slice(0, TASKLIST_VISIBLE_LIMIT);
  const overflow = notDone.length - visible.length;
  const pulseFilled = Math.floor(now / TASKLIST_PULSE_MS) % 2 === 0;
  const count = ` ${done}/${total}`;
  const lines: TerminalLine[] = [
    {
      spans: [
        { text: truncateToWidth(output.groupTitle, Math.max(1, contentWidth - width(count))), role: "tool-label" },
        { text: count, role: "muted" },
      ],
    },
    ...visible.map((item) => ({
      spans: [
        { text: `  ${taskItemGlyph(item.status, pulseFilled)} `, role: taskItemRole(item.status) },
        { text: truncateToWidth(item.label, Math.max(1, contentWidth - 4)), role: "muted" as const },
      ],
    })),
  ];
  if (overflow > 0) lines.push({ spans: [{ text: `  +${overflow} pending`, role: "muted" }] });
  return { lines };
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
    case "active":
      return "pending";
    default:
      return "tool";
  }
}

function toolMarkerGlyph(headerState: ToolHeaderState | undefined, status: TranscriptStatus): string {
  switch (headerState) {
    case "on":
      return GLYPH_FISHEYE;
    case "off":
      return GLYPH_HOLLOW;
    default:
      return status === "active" ? GLYPH_FISHEYE : GLYPH_FILLED;
  }
}

function toolHeaderMarkerRole(headerState: ToolHeaderState | undefined, status: TranscriptStatus): TerminalStyleRole {
  switch (headerState) {
    case "on":
      return "skill-on";
    case "off":
      return "skill-off";
    default:
      return toolMarkerRole(status);
  }
}

export function layoutTranscriptTool(input: {
  parts: ToolOutputPart[];
  status: TranscriptStatus;
  columns: number;
}): TerminalScene {
  const contentWidth = Math.max(24, input.columns - 2);
  const headerState = input.parts.find((part) => part.kind === "tool-header")?.state;
  const marker = `${toolMarkerGlyph(headerState, input.status)} `;
  const markerRole = toolHeaderMarkerRole(headerState, input.status);
  return {
    lines: layoutToolOutput(input.parts).map((line, index) => {
      const fitted = fitLine(
        { ...line, segments: line.segments.filter((segment) => segment.role !== "stream-tag") },
        contentWidth,
      );
      const fill =
        fitted.fill === "diff-add" ? "diff-added" : fitted.fill === "diff-remove" ? "diff-removed" : undefined;
      const spans = fitted.segments.flatMap((segment) => {
        const base = toolRole(segment.role);
        if (!base) return [];
        const role: TerminalStyleRole =
          fill && segment.role === "diff-text"
            ? fill
            : fill && segment.role === "diff-gutter"
              ? fill === "diff-added"
                ? "tool-meta-add"
                : "tool-meta-remove"
              : base;
        return [{ text: segment.text, role }];
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
  const cw = contentWidth(input.constraints.columns);
  const lines: TerminalLine[] = [];
  const sections: NonNullable<TerminalScene["sections"]> = [];
  const append = (id: string, finalized: boolean, scene: TerminalScene): void => {
    if (lines.length > 0) lines.push({ spans: [{ text: "", role: "plain" }] });
    const lineStart = lines.length;
    lines.push(...scene.lines);
    sections.push({ id, lineStart, lineEnd: lines.length, finalized });
  };
  append("header", true, insetScene(layoutHeader(input.presentation.header), CONTENT_COLUMN));
  for (const row of input.presentation.transcript) {
    if (row.content.kind === "tasklist") continue;
    if (row.content.kind === "tool-output") {
      append(
        row.id,
        row.status !== "active",
        insetScene(
          layoutTranscriptTool({ parts: row.content.output.parts, status: row.status, columns: cw }),
          CONTENT_COLUMN,
        ),
      );
    } else if (row.content.kind === "command-output") {
      const body = formatCommandOutput(row.content.output);
      const text = body ? `${row.content.output.header}\n\n${body}` : row.content.output.header;
      const marker = row.kind === "system" ? "  " : `${GLYPH_FILLED} `;
      const role: TerminalStyleRole = row.kind === "system" ? "muted" : "plain";
      // Command output is preformatted (aligned columns); preserve its whitespace and
      // truncate over-long lines rather than prose-wrapping, which would collapse the alignment.
      append(
        row.id,
        true,
        insetScene(
          {
            lines: text.split("\n").map((line, index) => ({
              spans: [
                { text: index === 0 ? marker : "  ", role },
                { text: truncateToWidth(line, cw - width(marker)), role },
              ],
            })),
          },
          CONTENT_COLUMN,
        ),
      );
    } else if (row.kind === "user" || row.kind === "assistant") {
      const message = layoutTranscriptMessage({
        text: row.content.text,
        kind: row.kind,
        columns: input.constraints.columns,
      });
      append(row.id, row.status !== "active", row.kind === "user" ? message : insetScene(message, CONTENT_COLUMN));
    } else {
      append(
        row.id,
        true,
        insetScene(
          layoutTranscriptText({
            text: row.content.text,
            marker: row.kind === "system" ? "  " : `${GLYPH_FILLED} `,
            markerRole: transcriptOutcomeRole(row.status),
            // System notices carry their level in the text color (error red, warning yellow);
            // status/task rows keep muted text and let the marker carry the outcome.
            textRole: row.kind === "system" ? transcriptOutcomeRole(row.status) : "muted",
            columns: cw,
          }),
          CONTENT_COLUMN,
        ),
      );
    }
  }
  if (input.presentation.pending)
    append(
      "pending",
      false,
      insetScene(
        layoutPending({ presentation: input.presentation.pending, now: input.now, columns: cw }),
        CONTENT_COLUMN,
      ),
    );
  for (const row of input.presentation.transcript) {
    if (row.content.kind !== "tasklist") continue;
    append(
      row.id,
      false,
      insetScene(
        layoutTranscriptTasklist((row.content as { output: TasklistOutput }).output, cw, input.now),
        CONTENT_COLUMN,
      ),
    );
  }
  const composer = layoutComposerStatus({
    presentation: input.presentation.composer,
    constraints: input.constraints,
  });
  if (lines.length > 0) lines.push({ spans: [{ text: "", role: "plain" }] });
  const composerStart = lines.length;
  lines.push(...composer.lines);
  sections.push({ id: "composer", lineStart: composerStart, lineEnd: lines.length, finalized: false });
  // Its own section below the box; hidden under help, suggestions, and an open picker, where a
  // status row below a completion list or picker looks out of place.
  const composerPresentation = input.presentation.composer;
  const showFooter =
    input.presentation.footer &&
    !composerPresentation.showHelp &&
    composerPresentation.suggestions.kind === "none" &&
    !composerPresentation.picker &&
    !composerPresentation.ctrlCPending;
  if (showFooter && input.presentation.footer) {
    const footerStart = lines.length;
    lines.push(...insetScene(layoutFooterStatus(input.presentation.footer, cw), CONTENT_COLUMN).lines);
    sections.push({ id: "footer", lineStart: footerStart, lineEnd: lines.length, finalized: false });
  }
  const cursor = composer.cursor ?? { row: 0, column: 0 };
  return { lines, sections, cursor: { ...cursor, row: cursor.row + composerStart } };
}
