import { relative } from "node:path";
import { z } from "zod";
import { unreachable } from "./assert";
import { wrapAssistantContent } from "./chat-content";
import { countLabel } from "./plural";
import { TOOL_OUTPUT_MARKERS, TOOL_OUTPUT_RUN_MAX_ROWS } from "./tool-output-format";
import { parseToolOutputMarker } from "./tool-output-parser";
import { parseToolProgressLine } from "./tool-progress";
import { printDim, printOutput, printToolHeader } from "./ui";

export { countLabel } from "./plural";

const editResultSchema = z.object({
  path: z.string().min(1),
  edits: z.coerce.number().int().nonnegative(),
  dryRun: z.boolean(),
});

const runExitCodeSchema = z.coerce.number().int();

export function displayPath(pathInput: string): string {
  const rel = relative(process.cwd(), pathInput);
  if (!rel || rel.startsWith("..")) return pathInput;
  return rel;
}

export function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

const ANSI = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[39m",
  resetDim: "\x1b[22m",
} as const;

function colorizeDiffLine(line: string): string {
  if (line.startsWith("@@ ")) return `${ANSI.dim}${line}${ANSI.resetDim}`;
  if (line.startsWith("+") && !line.startsWith("+++")) return `${ANSI.green}${line}${ANSI.reset}`;
  if (line.startsWith("-") && !line.startsWith("---")) return `${ANSI.red}${line}${ANSI.reset}`;
  if (line.startsWith("… +")) return `${ANSI.dim}${line}${ANSI.resetDim}`;
  return line;
}

export function showToolResult(
  title: string,
  content: string,
  style: "plain" | "tool" | "diff" = "plain",
  detail?: string,
): void {
  printToolHeader(title, detail);
  const lines = content.split("\n");
  if (lines.length === 0) {
    printDim("  └ (no output)");
    return;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const prefix = i === 0 ? "  └ " : "    ";
    if (style === "tool") {
      printOutput(`${prefix}${lines[i]}`);
    } else if (style === "diff") {
      printOutput(`${prefix}${colorizeDiffLine(lines[i] ?? "")}`);
    } else {
      printOutput(`${prefix}${lines[i]}`);
    }
  }
}

export function clampLines(lines: string[], maxLines: number, overflowTolerance = 4): string[] {
  if (lines.length <= maxLines + overflowTolerance) return lines;
  return [...lines.slice(0, maxLines - 1), `… +${countLabel(lines.length - (maxLines - 1), "line", "lines")}`];
}

export function formatSearchOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0 || (lines.length === 1 && lines[0].toLowerCase().startsWith("no matches")))
    return "No matches.";
  const files = new Set<string>();
  for (const line of lines) {
    const firstColon = line.indexOf(":");
    if (firstColon > 0) files.add(line.slice(0, firstColon));
  }
  const summary = `${countLabel(lines.length, "match", "matches")} in ${countLabel(files.size, "file", "files")}`;
  return [summary, ...clampLines(lines, 12)].join("\n");
}

export function formatReadOutput(raw: string): string {
  const lines = raw.split("\n");
  const normalized = [...lines];
  if (normalized[0]?.startsWith("File: ")) {
    const rawPath = normalized[0].slice("File: ".length).trim();
    normalized[0] = `File: ${displayPath(rawPath)}`;
  }
  const contentLines = Math.max(0, normalized.length - (normalized[0]?.startsWith("File: ") ? 1 : 0));
  const summary = countLabel(contentLines, "line", "lines");
  return [summary, ...clampLines(normalized, 48)].join("\n");
}

export function formatDiffOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.length > 0);
  let filesChanged = 0;
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      filesChanged += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) removed += 1;
  }
  const summary = `${countLabel(filesChanged, "file", "files")} changed, +${added} -${removed}`;
  return [summary, ...clampLines(lines, 64)].join("\n");
}

export function formatGitStatusOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "working tree clean";

  const branchLine = lines[0].startsWith("## ") ? lines[0] : undefined;
  const changed = lines.filter((line) => !line.startsWith("## ")).length;
  const summary = changed === 0 ? "working tree clean" : `${countLabel(changed, "changed file", "changed files")}`;
  const out: string[] = [summary];
  if (branchLine) out.push(branchLine);
  out.push(...lines.filter((line) => !line.startsWith("## ")));
  return clampLines(out, 6).join("\n");
}

export function formatRunOutput(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length === 0) return "(no output)";

  const exitLine = lines[0];
  const exitCode = Number.parseInt(exitLine.replace("exit_code=", "").trim(), 10);
  const durationLine = lines[1]?.startsWith("duration_ms=") ? lines[1] : null;
  const stdoutIdx = lines.findIndex((line) => line.trim() === "stdout:");
  const stderrIdx = lines.findIndex((line) => line.trim() === "stderr:");
  const out: string[] = [exitLine];
  if (durationLine) out.push(durationLine);

  const section = (name: "stdout:" | "stderr:", start: number, end: number): void => {
    if (start < 0) return;
    let payload = lines.slice(start + 1, end).filter((line) => line.trim().length > 0);
    if (name === "stderr:" && exitCode === 0 && stdoutIdx >= 0) payload = [];
    if (payload.length === 0) return;
    out.push(name);
    out.push(...clampLines(payload, TOOL_OUTPUT_RUN_MAX_ROWS));
  };

  const nextAfterStdout = stderrIdx >= 0 ? stderrIdx : lines.length;
  section("stdout:", stdoutIdx, nextAfterStdout);
  section("stderr:", stderrIdx, lines.length);

  return out.join("\n");
}

export function parseRunExitCode(raw: string): number | null {
  const first = raw.split("\n")[0]?.trim() ?? "";
  const match = first.match(/^exit_code=([^\\s]+)$/);
  if (!match) return null;
  const parsed = runExitCodeSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}

export function formatForTool(kind: "find" | "search" | "read" | "diff" | "run" | "status", raw: string): string {
  if (kind === "find" || kind === "search") return formatSearchOutput(raw);
  if (kind === "read") return formatReadOutput(raw);
  if (kind === "diff") return formatDiffOutput(raw);
  if (kind === "run") return formatRunOutput(raw);
  return formatGitStatusOutput(raw);
}

export function summarizeDiff(raw: string): {
  added: number;
  removed: number;
  locations: number;
  preview: string[];
} {
  const preview: string[] = [];
  let added = 0;
  let removed = 0;
  let locations = 0;
  const lines = raw.split("\n");
  for (const line of lines) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("@@ ")) {
      locations += 1;
      preview.push(line);
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) removed += 1;
  }

  // Build a compact hunk-centered preview with one context line around edits.
  let currentHunkHeader = "";
  let currentHunkBody: string[] = [];
  const excerpt: string[] = [];
  const flushHunk = (): void => {
    if (!currentHunkHeader) return;
    const changedIdxs = currentHunkBody
      .map((line, index) => ({ line, index }))
      .filter((entry) => entry.line.startsWith("+") || entry.line.startsWith("-"))
      .map((entry) => entry.index);
    if (changedIdxs.length === 0) {
      currentHunkHeader = "";
      currentHunkBody = [];
      return;
    }
    const include = new Set<number>();
    for (const idx of changedIdxs) {
      include.add(idx - 1);
      include.add(idx);
      include.add(idx + 1);
    }
    excerpt.push(currentHunkHeader);
    for (let i = 0; i < currentHunkBody.length; i += 1) {
      if (!include.has(i)) continue;
      const line = currentHunkBody[i];
      if (line === undefined) continue;
      excerpt.push(line);
    }
    currentHunkHeader = "";
    currentHunkBody = [];
  };

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      flushHunk();
      currentHunkHeader = line;
      currentHunkBody = [];
      continue;
    }
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (!currentHunkHeader) continue;
    currentHunkBody.push(line);
  }
  flushHunk();

  return { added, removed, locations, preview: clampLines(excerpt, 18) };
}

export function formatEditUpdateOutput(matches: number, diff: string): string {
  const summary = summarizeDiff(diff);
  const lines = [
    `${countLabel(matches, "replacement", "replacements")} applied.`,
    `${countLabel(summary.locations, "location", "locations")} updated.`,
    `Added ${countLabel(summary.added, "line", "lines")}, removed ${countLabel(summary.removed, "line", "lines")}.`,
  ];
  if (summary.preview.length > 0) {
    lines.push("Preview:");
    lines.push(...summary.preview);
  } else {
    lines.push("No diff preview available (file may be untracked or unchanged in git).");
  }
  return lines.join("\n");
}

export function formatReadDetail(pathInput: string, start?: string, end?: string): string {
  if (!start && !end) return pathInput;
  const from = start ?? "1";
  const to = end ?? "EOF";
  return `${pathInput}:${from}-${to}`;
}

export function formatAssistantReplyOutput(content: string, wrapWidth = 100): string {
  const wrapped = wrapAssistantContent(content, wrapWidth);
  const lines = wrapped.split("\n");
  if (lines.length === 0) return "•";
  return lines
    .map((line, index) => {
      if (index === 0) return line.length > 0 ? `• ${line}` : "•";
      return line.length > 0 ? `  ${line}` : "";
    })
    .join("\n");
}

export function formatProgressOutput(
  content: string,
  options?: { lineNumberWidth?: number; bullet?: boolean },
): string {
  const dim = (value: string): string => `\x1b[2m${value}\x1b[22m`;
  const bold = (value: string): string => `\x1b[1m${value}\x1b[22m`;
  const green = (value: string): string => `\x1b[32m${value}\x1b[39m`;
  const red = (value: string): string => `\x1b[31m${value}\x1b[39m`;
  const greenBg = (value: string): string => `\x1b[32m\x1b[48;2;13;40;24m${value}\x1b[49m\x1b[39m`;
  const redBg = (value: string): string => `\x1b[31m\x1b[48;2;45;11;11m${value}\x1b[49m\x1b[39m`;
  const normalizedContent = content.replace(/^\n+/, "");
  const rawLines = normalizedContent.split("\n");
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i] ?? "";
    const previous = lines[lines.length - 1] ?? "";
    if (line === TOOL_OUTPUT_MARKERS.noOutput && /^query="(?:\\.|[^"])*"\s+results=0$/i.test(previous)) continue;
    lines.push(line);
  }
  const parsedLines = lines.map((line) => parseToolProgressLine(line));
  const rootHeaderLabel = parsedLines[0]?.kind === "header" ? parsedLines[0].label : undefined;
  const inferredLineNumberWidth = parsedLines.reduce((max, parsed) => {
    if (parsed.kind === "numberedDiff" || parsed.kind === "numberedContext")
      return Math.max(max, parsed.lineNumber.length);
    return max;
  }, 0);
  const lineNumberWidth = Math.max(options?.lineNumberWidth ?? 0, inferredLineNumberWidth);
  const terminalWidth = process.stdout.columns ?? 120;

  const wrapText = (text: string, maxWidth: number): string[] => {
    if (maxWidth <= 0 || text.length <= maxWidth) return [text];
    const words = text.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) return [text];
    const out: string[] = [];
    let current = "";
    const pushCurrent = (): void => {
      if (current.length > 0) out.push(current);
      current = "";
    };
    for (const word of words) {
      if (word.length > maxWidth) {
        pushCurrent();
        for (let i = 0; i < word.length; i += maxWidth) out.push(word.slice(i, i + maxWidth));
        continue;
      }
      if (current.length === 0) {
        current = word;
        continue;
      }
      const next = `${current} ${word}`;
      if (next.length <= maxWidth) {
        current = next;
        continue;
      }
      pushCurrent();
      current = word;
    }
    pushCurrent();
    return out.length > 0 ? out : [text];
  };

  const formatWrappedHeader = (
    parsed: Extract<ReturnType<typeof parseToolProgressLine>, { kind: "header" }>,
    includeBullet: boolean,
  ): string => {
    const prefix = includeBullet ? "• " : "    ";
    const labelToken = parsed.detail ? `${parsed.label} ` : parsed.label;
    if (!parsed.detail) return `${prefix}${bold(labelToken)}`;
    const detailIndent = " ".repeat(prefix.length + labelToken.length);
    const firstLineWidth = Math.max(8, terminalWidth - prefix.length - labelToken.length);
    const continuationWidth = Math.max(8, terminalWidth - detailIndent.length);
    const wrappedDetail = wrapText(parsed.detail, firstLineWidth);
    const first = `${prefix}${bold(labelToken)}${dim(wrappedDetail[0] ?? "")}`;
    if (wrappedDetail.length === 1) return first;
    const restLines = wrappedDetail.slice(1).flatMap((line) => wrapText(line, continuationWidth));
    const rest = restLines.map((line) => `${detailIndent}${dim(line)}`).join("\n");
    return `${first}\n${rest}`;
  };

  const colorize = (parsed: ReturnType<typeof parseToolProgressLine>): string => {
    const parseQuoted = (token: string): string => {
      try {
        return JSON.parse(token) as string;
      } catch {
        return token.replace(/^"|"$/g, "");
      }
    };
    const formatWebMachineLine = (line: string): string | null => {
      const summary = line.match(/^query=(".*")\s+results=(\d+)$/);
      if (summary?.[1] && summary[2]) {
        const query = parseQuoted(summary[1]);
        return `Search "${query}"`;
      }
      const result = line.match(/^result rank=(\d+)(?: url=(".*"))?$/);
      if (result?.[1]) {
        const rank = result[1];
        const url = result[2] ? parseQuoted(result[2]) : null;
        return url ? `${rank}. ${url}` : `${rank}.`;
      }
      return null;
    };
    switch (parsed.kind) {
      case "header":
        return parsed.detail ? `${bold(`${parsed.label} `)}${dim(parsed.detail)}` : bold(parsed.label);
      case "numberedDiff": {
        const colorBg = parsed.marker === "+" ? greenBg : redBg;
        const paddedLineNumber =
          lineNumberWidth > 0 ? parsed.lineNumber.padStart(lineNumberWidth, " ") : parsed.lineNumber;
        // Keep line content aligned with context rows while hiding +/- in formatted output.
        const raw = `${paddedLineNumber}${parsed.spacing} ${parsed.text.length > 0 ? parsed.text : " "}`;
        const cols = process.stdout.columns ?? 120;
        return colorBg(raw.length < cols - 4 ? raw.padEnd(cols - 4) : raw);
      }
      case "numberedContext": {
        const paddedLineNumber =
          lineNumberWidth > 0 ? parsed.lineNumber.padStart(lineNumberWidth, " ") : parsed.lineNumber;
        const spacing = parsed.spacing.length > 0 ? parsed.spacing : "   ";
        return `${dim(paddedLineNumber)}${spacing}${parsed.text}`;
      }
      case "commandOutput":
        if (parsed.stream === "err" && !parsed.text.startsWith("$ ")) return dim(red(parsed.text));
        return dim(parsed.text);
      case "fileDiff":
        return parsed.marker === "+" ? green(parsed.text) : red(parsed.text);
      case "meta":
        if (parsed.text === TOOL_OUTPUT_MARKERS.noOutput) return dim("(No output)");
        if (parsed.text === TOOL_OUTPUT_MARKERS.truncated) return dim("…".padStart(Math.max(1, lineNumberWidth), " "));
        {
          const marker = parseToolOutputMarker(parsed.text);
          if (marker.kind === "truncated") {
            if ((rootHeaderLabel === "Find" || rootHeaderLabel === "Search") && !marker.unit)
              return dim(
                `… +${countLabel(marker.count, "match", "matches")}`.padStart(Math.max(1, lineNumberWidth), " "),
              );
            if (marker.count <= 0) return dim("…".padStart(Math.max(1, lineNumberWidth), " "));
            const suffix = marker.unit ? ` ${marker.unit}` : "";
            return dim(`… +${marker.count}${suffix}`.padStart(Math.max(1, lineNumberWidth), " "));
          }
        }
        if (options?.lineNumberWidth != null) {
          const rest = parsed.text.length > 1 ? parsed.text.slice(1) : "";
          return `${dim("…".padStart(lineNumberWidth, " "))}${dim(rest)}`;
        }
        return dim(parsed.text);
      case "text": {
        const formatted = formatWebMachineLine(parsed.text);
        return formatted ?? parsed.text;
      }
      default:
        return unreachable(parsed);
    }
  };
  if (lines.length === 0) return options?.bullet === false ? "" : "•";
  const includeBullet = options?.bullet ?? true;
  return lines
    .map((line, index) => {
      const parsed = parsedLines[index] ?? parseToolProgressLine(line);
      if (index === 0) {
        if (parsed.kind === "header") return formatWrappedHeader(parsed, includeBullet);
        if (!includeBullet) return line.length > 0 ? `    ${colorize(parsed)}` : "";
        return line.length > 0 ? `• ${colorize(parsed)}` : "•";
      }
      return line.length > 0 ? `    ${colorize(parsed)}` : "";
    })
    .join("\n");
}

export function parseEditResult(raw: string): { path: string; edits: number; dryRun: boolean } | null {
  const path = raw.match(/^path=(.*)$/m)?.[1]?.trim();
  const editsText = raw.match(/^edits=(.*)$/m)?.[1]?.trim();
  const dryRunText = raw.match(/^dry_run=(.*)$/m)?.[1]?.trim();
  if (!path || !editsText || !dryRunText) return null;
  if (dryRunText !== "true" && dryRunText !== "false") return null;
  const parsed = editResultSchema.safeParse({
    path,
    edits: editsText,
    dryRun: dryRunText === "true",
  });
  return parsed.success ? parsed.data : null;
}
