import { extname } from "node:path";
import { z } from "zod";
import { unreachable } from "./assert";
import { segmentAssistantContent, wrapAssistantContent, wrapUserText } from "./chat-content";
import { alignCols, formatCommandOutput } from "./chat-format";
import { GLYPH_FILLED, GLYPH_FISHEYE, GLYPH_HOLLOW, GLYPH_USER } from "./chat-glyphs";
import { PICKER_LABEL_WIDTH, PICKER_PAGE_SIZE } from "./chat-picker";
import { type MarkupToken, tokenize } from "./chat-tokenizer";
import type { TranscriptStatus } from "./chat-transcript-contract";
import type { ChatViewportPresentation, PendingPresentation } from "./chat-viewport-contract";
import { highlightCode, resolveLanguage } from "./code-highlight";
import { formatRelativeTime } from "./datetime";
import type { EffectRow } from "./effect-contract";
import type { FooterStatus } from "./footer-status-contract";
import type { PrState } from "./gh-contract";
import { t } from "./i18n";
import { formatCompactNumber } from "./number-format";
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
const HELP_COLUMNS = 3;
const HELP_COLUMN_GAP = 2;

/** Keeps a composed row inside the content width by cutting the spans that run past it. */
function clipSpans(spans: TerminalSpan[], limit: number): TerminalSpan[] {
  const out: TerminalSpan[] = [];
  let used = 0;
  for (const span of spans) {
    const room = limit - used;
    if (room <= 0) break;
    const text = width(span.text) <= room ? span.text : truncateToWidth(span.text, room);
    out.push({ ...span, text });
    used += width(text);
  }
  return out;
}

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
    case "ref":
      return { text: token.text, role: "assistant-code" };
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
function frameScene(interior: TerminalScene, columns: number, borderRole: TerminalStyleRole): TerminalScene {
  const inner = contentWidth(columns);
  const gutter = " ".repeat(GUTTER);
  // The rule spans the interior the body rows pad to, so the corners meet the vertical borders at
  // every width — `contentWidth` clamps, and a rule measured off `columns` would not.
  const rule = "─".repeat(inner + 2 * BOX_PAD);
  const horizontal = (left: string, right: string): TerminalLine => ({
    spans: [
      { text: gutter, role: "plain" },
      { text: `${left}${rule}${right}`, role: borderRole },
    ],
  });
  const frame = (line: TerminalLine): TerminalLine => {
    const pad = Math.max(0, inner - lineWidth(line));
    return {
      ...line,
      spans: [
        { text: gutter, role: "plain" },
        { text: "│", role: borderRole },
        { text: " ".repeat(BOX_PAD), role: "plain" },
        ...line.spans,
        ...(pad > 0 ? [{ text: " ".repeat(pad), role: "plain" as const }] : []),
        { text: " ".repeat(BOX_PAD), role: "plain" },
        { text: "│", role: borderRole },
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
        for (const line of wrapAssistantContent(segment.text.trimEnd(), textWrap).split("\n")) {
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
  // A sent message takes the composer's own frame, so what was typed and what was sent read as one
  // object. Interior text measures against the same `contentWidth` the composer wraps to, which is
  // what keeps a message the same shape after it leaves the input.
  const budget = Math.max(1, contentWidth(input.columns) - width(marker));
  // Fenced code highlights like the assistant path; unfenced text stays one prose segment and
  // renders verbatim (whitespace-faithful). An empty row array is a blank interior row.
  const rows: TerminalSpan[][] = [];
  segmentAssistantContent(input.text).forEach((segment, index) => {
    if (index > 0) rows.push([]);
    if (segment.kind === "prose") {
      for (const line of wrapUserText(segment.text, budget)) {
        rows.push(/\S/.test(line) ? tokenize(line).map((token) => assistantTokenSpan(token, role)) : []);
      }
    } else {
      for (const codeLine of highlightCode(segment.text, segment.lang)) {
        for (const wrapped of wrapSpans(codeLine, budget)) rows.push(wrapped);
      }
    }
  });
  const interior: TerminalScene = {
    lines: rows.map((spans, index) =>
      index > 0 && spans.length === 0
        ? { spans: [] }
        : { spans: [{ text: index === 0 ? marker : "  ", role }, ...spans] },
    ),
  };
  return frameScene(interior, input.columns, "message-border");
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
      text: index === 0 ? `${pendingMarkerGlyph(running, input.now)} ` : "  ",
      role: markerRole,
    };
    const body: TerminalSpan[] = running
      ? shimmerSpans(line, shimmerOffset, sweepPos)
      : [{ text: line, role: "muted" }];
    shimmerOffset += line.length;
    return { spans: [marker, ...body] };
  });
  // Padding is asymmetric because the trailing inter-section separator supplies the fourth row:
  // 2 above and 1 here render as the 2-and-2 of the sent user row this becomes when the queue drains.
  for (const message of presentation.queuedMessages) {
    lines.push({ spans: [{ text: "", role: "plain" }] });
    lines.push({ spans: [{ text: "", role: "plain" }] });
    lines.push(
      ...wrapUserText(message, Math.max(24, input.columns - 2)).map((line, index) => ({
        spans: [
          { text: index === 0 ? "❯ " : "  ", role: "muted" as const },
          { text: line, role: "muted" as const },
        ],
      })),
    );
    lines.push({ spans: [{ text: "", role: "plain" }] });
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
      const modelPrefix = `${t("tui.picker.label.model")} `;
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
      const title = picker.kind === "skills" ? t("tui.picker.title.skills") : t("tui.picker.title.resume");
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
      pickerItems = [{ spans: [{ text: `  ${t("tui.picker.loading")}`, role: "muted" }] }];
    } else if (visible.length === 0) {
      pickerItems = [{ spans: [{ text: ` ${t("tui.picker.no_matches")}`, role: "muted" }] }];
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
        // Only an authored skill names its scope: a bundled one is what remains when nothing took the name.
        const scope = item.source && item.source !== "bundled" ? `${item.source} · ` : "";
        const detail = `${scope}${item.detail ?? ""}`;
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
      "composer-border",
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
  const boxed = frameScene(
    { lines: promptLines, cursor: { row: caretRow, column: caretColumn } },
    terminalWidth,
    "composer-border",
  );
  const attached: TerminalLine[] = [];
  if (presentation.showHelp) {
    const rows = Math.ceil(presentation.helpEntries.length / HELP_COLUMNS);
    const columns = Array.from({ length: HELP_COLUMNS }, (_, column) =>
      presentation.helpEntries.slice(column * rows, column * rows + rows),
    );
    const columnWidths = columns.map((entries) =>
      Math.max(0, ...entries.map((entry) => width(entry.key) + 1 + width(entry.description))),
    );
    for (let row = 0; row < rows; row++) {
      const spans: TerminalSpan[] = [];
      for (const [column, entries] of columns.entries()) {
        const entry = entries[row];
        if (!entry) continue;
        const cell = width(entry.key) + 1 + width(entry.description);
        const trailing = column === columns.length - 1 ? 0 : (columnWidths[column] ?? 0) - cell + HELP_COLUMN_GAP;
        spans.push(
          { text: `${spans.length === 0 ? "  " : ""}${entry.key} `, role: "plain" },
          { text: `${entry.description}${" ".repeat(Math.max(0, trailing))}`, role: "muted" },
        );
      }
      attached.push({ spans: clipSpans(spans, cw) });
    }
  } else if (presentation.suggestions.kind === "at") {
    const selected = presentation.suggestions.selected;
    if (presentation.suggestions.noMatches)
      attached.push({ spans: [{ text: ` ${t("tui.suggestions.no_matches")}`, role: "muted" }] });
    else
      attached.push(
        ...presentation.suggestions.candidates.map((candidate, index) => ({
          spans: [
            {
              text: truncateToWidth(`${index === selected ? "› " : "  "}${candidate.label}`, cw),
              role: index === selected ? ("selected" as const) : ("plain" as const),
            },
          ],
        })),
      );
  } else if (presentation.suggestions.kind === "slash") {
    const selected = presentation.suggestions.selected;
    // Each command carries its help in a dim column (like the skills picker), so the whole list
    // is legible at once instead of only the selected row's help on a line below. The column grows
    // to the longest command offered, since an ellipsized candidate hides what the user must type.
    const widest = Math.max(...presentation.suggestions.candidates.map((candidate) => width(candidate.command)));
    const labelWidth = Math.max(1, Math.min(Math.max(PICKER_LABEL_WIDTH, widest), cw - 4));
    attached.push(
      ...presentation.suggestions.candidates.map((candidate, index) => {
        const label = truncateToWidth(candidate.command, labelWidth).padEnd(labelWidth);
        const help = candidate.help ?? "";
        if (index === selected)
          return { spans: [{ text: truncateToWidth(`› ${label} ${help}`, cw), role: "selected" as const }] };
        return {
          spans: [
            { text: `  ${label}`, role: "plain" as const },
            { text: truncateToWidth(` ${help}`, Math.max(1, cw - 2 - labelWidth)), role: "muted" as const },
          ],
        };
      }),
    );
  }
  if (!presentation.showHelp && presentation.suggestions.kind === "none" && presentation.ctrlCPending)
    attached.push({ spans: [{ text: t("tui.input.ctrl_c_hint"), role: "muted" }] });
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

const FOOTER_SEPARATOR: TerminalSpan = { text: " · ", role: "faint" };

/** A footer item wraps whole: unlike prose, a model name or a skill name must not split across lines. */
function packFooterItems(items: TerminalSpan[][], columns: number): TerminalLine[] {
  const lines: TerminalSpan[][] = [];
  let current: TerminalSpan[] = [];
  let currentWidth = 0;
  for (const item of items) {
    const itemWidth = item.reduce((total, span) => total + width(span.text), 0);
    if (current.length > 0 && currentWidth + width(FOOTER_SEPARATOR.text) + itemWidth > columns) {
      lines.push(current);
      current = [];
      currentWidth = 0;
    }
    if (current.length > 0) {
      current.push(FOOTER_SEPARATOR);
      currentWidth += width(FOOTER_SEPARATOR.text);
    }
    current.push(...item);
    currentWidth += itemWidth;
  }
  lines.push(current);
  return lines.map((spans) => ({ spans: clipSpans(spans, columns) }));
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
  const items: TerminalSpan[][] = [];
  // A name yields columns to the state that follows it: a clipped line would otherwise cut the
  // dirty/ahead/behind markers and the effort level, which is where the line's meaning sits.
  for (const name of names) {
    const marker = name === status.branch ? suffix : "";
    const spans: TerminalSpan[] = [
      { text: truncateToWidth(name, Math.max(1, columns - width(marker))), role: "subtle" },
    ];
    if (marker) spans.push({ text: marker, role: "faint" });
    items.push(spans);
  }
  const effort = status.effort ? ` ${status.effort}` : "";
  const model: TerminalSpan[] = [
    { text: truncateToWidth(status.model, Math.max(1, columns - width(effort))), role: "subtle" },
  ];
  if (effort) model.push({ text: effort, role: "faint" });
  items.push(model);
  if (status.inputTokens || status.outputTokens) {
    items.push([
      {
        text: t("unit.token.arrows", {
          input: formatCompactNumber(status.inputTokens),
          output: formatCompactNumber(status.outputTokens),
        }),
        role: "faint",
      },
    ]);
  }
  if (status.pr) {
    items.push([
      { text: "PR ", role: "faint" },
      { text: `#${status.pr.number}`, role: prStateRole(status.pr.state) },
    ]);
  }
  // The active skills are one part, so the whole set moves together when the line wraps.
  if (status.skills.length > 0) {
    items.push([{ text: status.skills.join(" "), role: "faint" }]);
  }
  return { lines: packFooterItems(items, columns) };
}

const TASKLIST_VISIBLE_LIMIT = 5;
const MARKER_PULSE_MS = 500;

/** Work in flight, wherever it is drawn: the marker pulses between absent and active. A settled
 *  glyph never appears in the cycle, so nothing mid-pulse can be misread as finished. */
function pulseGlyph(filled: boolean): string {
  return filled ? GLYPH_FISHEYE : GLYPH_HOLLOW;
}

function markerPulseFilled(now: number): boolean {
  return Math.floor(now / MARKER_PULSE_MS) % 2 === 0;
}

/** Only a running turn pulses. A queued or accepted one has not started, and a steady fisheye would
 *  claim it had. */
function pendingMarkerGlyph(running: boolean, now: number): string {
  if (!running) return GLYPH_FILLED;
  return pulseGlyph(markerPulseFilled(now));
}

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
  if (status === "in_progress") return pulseGlyph(pulseFilled);
  return tasklistMarker(status);
}

// Display-only bounded view: the semantic tasklist keeps every item; done collapses into the count.
// `animating` gates the pulse on a running turn: the only clock that re-renders this scene is the
// pending indicator's, so with no turn in flight `now` stops advancing and the active item has to
// settle on its steady marker rather than freeze on whichever phase the last render sampled.
export function layoutTranscriptTasklist(
  output: TasklistOutput,
  contentWidth: number,
  now: number,
  animating: boolean,
): TerminalScene {
  const sorted = [...output.items].sort((a, b) => a.order - b.order);
  const { done, total } = tasklistProgress(sorted);
  const notDone = sorted.filter((item) => item.status !== "done");
  const visible = notDone.slice(0, TASKLIST_VISIBLE_LIMIT);
  const overflow = notDone.length - visible.length;
  const pulseFilled = !animating || markerPulseFilled(now);
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
        { text: `${taskItemGlyph(item.status, pulseFilled)} `, role: taskItemRole(item.status) },
        { text: truncateToWidth(item.label, Math.max(1, contentWidth - 2)), role: "muted" as const },
      ],
    })),
  ];
  if (overflow > 0) lines.push({ spans: [{ text: `+${overflow} pending`, role: "muted" }] });
  return { lines };
}

function toolRole(role: string): TerminalStyleRole | null {
  if (role === "label") return "tool-label";
  if (role === "meta-add") return "tool-meta-add";
  if (role === "meta-remove") return "tool-meta-remove";
  if (role === "diff-text") return "plain";
  if (role === "summary") return "faint";
  if (role === "stream-tag") return null;
  return "muted";
}

// A changed line's segment role once its band is known: text takes the band color, the gutter takes
// the matching meta tint, everything else keeps its base role.
function bandSpanRole(role: string, band: TerminalStyleRole | undefined, base: TerminalStyleRole): TerminalStyleRole {
  if (!band) return base;
  if (role === "diff-text") return band;
  if (role === "diff-gutter") return band === "diff-added" ? "tool-meta-add" : "tool-meta-remove";
  return base;
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

function toolMarkerGlyph(
  headerState: ToolHeaderState | undefined,
  status: TranscriptStatus,
  pulseFilled: boolean,
): string {
  switch (headerState) {
    case "on":
      return GLYPH_FISHEYE;
    case "off":
      return GLYPH_HOLLOW;
    default:
      return status === "active" ? pulseGlyph(pulseFilled) : GLYPH_FILLED;
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
  now: number;
  animating: boolean;
}): TerminalScene {
  const contentWidth = Math.max(24, input.columns - 2);
  const headerState = input.parts.find((part) => part.kind === "tool-header")?.state;
  const marker = `${toolMarkerGlyph(headerState, input.status, !input.animating || markerPulseFilled(input.now))} `;
  const markerRole = toolHeaderMarkerRole(headerState, input.status);
  const editPath = input.parts.find((part) => part.kind === "edit-header")?.path;
  const diffLang = editPath ? resolveLanguage(extname(editPath).slice(1)) : null;
  return {
    lines: layoutToolOutput(input.parts).map((line, index) => {
      const fitted = fitLine(
        { ...line, segments: line.segments.filter((segment) => segment.role !== "stream-tag") },
        contentWidth,
      );
      const band = fitted.change === "added" ? "diff-added" : fitted.change === "removed" ? "diff-removed" : undefined;
      const spans = fitted.segments.flatMap((segment) => {
        const base = toolRole(segment.role);
        if (!base) return [];
        // Removed lines stay flat red: the code is being discarded, so highlighting it is just noise.
        if (segment.role === "diff-text" && diffLang && fitted.change !== "removed") {
          const [lineSpans = []] = highlightCode(segment.text, diffLang);
          return lineSpans;
        }
        return [{ text: segment.text, role: bandSpanRole(segment.role, band, base) }];
      });
      const padding = band
        ? " ".repeat(Math.max(0, contentWidth - fitted.indent - segmentsWidth(fitted.segments)))
        : "";
      return {
        fill: band,
        spans: [
          { text: index === 0 ? marker : " ".repeat(fitted.indent + 2), role: markerRole },
          ...spans,
          ...(padding ? [{ text: padding, role: "plain" as const }] : []),
        ],
      };
    }),
  };
}

const EFFECT_LABEL = "Effect";

// An effect reports work the harness already did, so the row is settled the moment it is drawn: a
// dim marker, never a phase glyph, and no outcome to colour it. It shares the tool row's body
// primitives, not its top-level layout, because none of that row's progress and verdict apply here.
export function layoutTranscriptEffect(input: { row: EffectRow; columns: number }): TerminalScene {
  const contentWidth = Math.max(24, input.columns - 2);
  const header: TerminalLine = {
    spans: clipSpans(
      [
        { text: `${GLYPH_FILLED} `, role: "effect" },
        { text: EFFECT_LABEL, role: "tool-label" },
        { text: ` ${input.row.command}`, role: "effect" },
      ],
      contentWidth + 2,
    ),
  };
  const body = layoutToolOutput(input.row.output).map((line) => {
    const fitted = fitLine(line, contentWidth);
    return {
      spans: [
        { text: " ".repeat(fitted.indent + 2), role: "plain" as const },
        ...fitted.segments.flatMap((segment) => {
          const base = toolRole(segment.role);
          return base ? [{ text: segment.text, role: base }] : [];
        }),
      ],
    };
  });
  return { lines: [header, ...body] };
}

export function layoutChatViewport(input: {
  presentation: ChatViewportPresentation;
  /** Rows whose tool output is still on screen ahead of the header that replaces it. The outcome is
   *  already on the row; promoting it now would commit output the replacement takes away. */
  held: ReadonlySet<string>;
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
        row.status !== "active" && !input.held.has(row.id),
        insetScene(
          layoutTranscriptTool({
            parts: row.content.output.parts,
            status: row.status,
            columns: cw,
            now: input.now,
            animating: input.presentation.pending !== null,
          }),
          CONTENT_COLUMN,
        ),
      );
    } else if (row.content.kind === "effect") {
      append(
        row.id,
        true,
        insetScene(layoutTranscriptEffect({ row: row.content.output, columns: cw }), CONTENT_COLUMN),
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
    } else if (row.kind === "command") {
      // Control input never reaches the model, so it echoes as one line rather than taking the
      // composer frame a message keeps.
      append(
        row.id,
        true,
        insetScene(
          layoutTranscriptText({
            text: row.content.text,
            marker: `${GLYPH_USER} `,
            markerRole: "user",
            textRole: "user",
            columns: cw,
          }),
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
        layoutTranscriptTasklist(
          (row.content as { output: TasklistOutput }).output,
          cw,
          input.now,
          input.presentation.pending !== null,
        ),
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
