import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { createPathMatcher } from "./glob-match";
import { estimateTokens } from "./token-estimate";
import { createToolError } from "./tool-error";

/** Owner-only read/write. Use for files containing secrets or sensitive metadata. */
export const PRIVATE_FILE_MODE = 0o600;

import { createDiff } from "./diff-ops";
import { collectWorkspaceFiles, displayPathForDiff, isBinaryExtension, resolveSearchScopeFiles } from "./tool-utils";
import { ensurePathWithinSandbox } from "./workspace-sandbox";

export type FindReplaceEdit = { find: string; replace: string };
export type LineRangeEdit = { startLine: number; endLine: number; replace: string };
export type FileEdit = FindReplaceEdit | LineRangeEdit;

export type FileReadOptions = {
  offset?: number;
  limit?: number;
};

export type FileReadResult = {
  output: string;
  totalLines: number;
  startLine: number;
  endLine: number;
};

const MAX_FIND_SNIPPET_LINES = 8;
const MAX_FIND_SNIPPET_CHARS = 500;
const MAX_FIND_REPLACE_LINES = 24;
const MAX_FIND_REPLACE_CHARS = 1600;
const MAX_BATCH_EDIT_LINES = 32;
const MAX_BATCH_EDIT_CHARS = 2400;
// `readFileContent` materializes the whole file to slice lines, so this bounds daemon
// memory rather than the model's budget — it never binds a legitimate whole-file read.
export const FILE_READ_MAX_BYTES = 5 * 1024 * 1024;
// ~12% of the flat per-call input budget, measured on the numbered output the model
// actually receives so the line-number overhead counts against the ceiling, not on top.
export const FILE_READ_MAX_TOKENS = 20_000;

export type FindFilesResult = { output: string; totalMatches: number; truncated: boolean };

export async function findFiles(workspace: string, patterns: string[], maxResults = 40): Promise<FindFilesResult> {
  if (patterns.length === 0) throw new Error("At least one pattern is required");
  const { files: allFiles, truncated: workspaceTruncated } = await collectWorkspaceFiles(workspace);
  const multi = patterns.length > 1;
  const sections: string[] = [];
  let totalMatches = 0;

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    const relativePattern = toWorkspaceRelativePattern(trimmed, workspace);
    const needle = relativePattern.replace(/^\.\/+/, "").toLowerCase();
    const matches = createPathMatcher(relativePattern);

    const rank = (path: string) => {
      const lower = path.toLowerCase();
      if (lower === needle) return 0;
      if (lower.endsWith(`/${needle}`)) return 1;
      return 2;
    };
    const matched = allFiles.filter(matches).sort((a, b) => rank(a) - rank(b) || a.length - b.length);
    const ranked = matched.slice(0, maxResults).map((path) => `./${path}`);
    totalMatches += matched.length;

    if (multi) sections.push(`--- ${trimmed} ---`);
    sections.push(
      ranked.length > 0
        ? ranked.join("\n")
        : workspaceTruncated
          ? "No matches in the scanned workspace files; the scan stopped at its limit."
          : "No matches.",
    );
    if (workspaceTruncated || matched.length > ranked.length) {
      sections.push(
        `(${workspaceTruncated ? "At least " : ""}${matched.length} files matched, showing the first ${ranked.length}. Narrow the pattern to see the rest.)`,
      );
    }
  }

  if (sections.length === 0) sections.push("No matches."); // every pattern was blank
  return { output: sections.join("\n"), totalMatches, truncated: workspaceTruncated };
}

/** Nothing is rejected here: the candidates are already confined to the workspace. */
function toWorkspaceRelativePattern(pattern: string, workspace: string): string {
  const prefix = workspace.endsWith("/") ? workspace : `${workspace}/`;
  return pattern.startsWith(prefix) ? `/${pattern.slice(prefix.length)}` : pattern;
}

export async function searchFiles(
  workspace: string,
  patterns: string[],
  maxResults = 40,
  paths?: string[],
): Promise<string> {
  const normalized = patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
  if (normalized.length === 0) throw new Error("Search pattern cannot be empty");
  const normalizedPaths = (paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  const allFiles = await resolveSearchScopeFiles(workspace, paths);
  if (normalizedPaths.length > 0 && allFiles.length === 0) {
    throw createToolError(
      TOOL_ERROR_CODES.searchFilesEmptyScope,
      `No searchable files in scope: ${normalizedPaths.join(", ")}. Broaden the search or use file-find first.`,
    );
  }
  const singleScopedFile = normalizedPaths.length === 1 && allFiles.length === 1 ? normalizedPaths[0] : undefined;
  const matches: string[] = [];
  const regexes = normalized.map((pattern) => {
    try {
      return new RegExp(pattern, "i");
    } catch {
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
  });

  // Collect one past the cap so a truncated search can say so instead of reading as the
  // whole truth. The extra match is dropped before the result is returned.
  let skippedBinary = false;
  for (const relPath of allFiles) {
    if (matches.length > maxResults) break;
    if (isBinaryExtension(relPath)) {
      skippedBinary = true;
      continue;
    }
    const absPath = join(workspace, relPath);
    let content: string;
    try {
      content = await Bun.file(absPath).text();
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (regexes.some((regex) => regex.test(line))) {
        const lineText = (lines[i] ?? "").trimEnd();
        matches.push(`./${relPath}:${i + 1}:${lineText}`);
        if (matches.length > maxResults) break;
      }
    }
  }

  const capped = matches.length > maxResults;
  if (capped) matches.length = maxResults;
  if (matches.length > 0) {
    if (!capped) return matches.join("\n");
    return `${matches.join("\n")}\nCapped at ${maxResults} results; more matches exist. Narrow the pattern or raise maxResults.`;
  }
  if (singleScopedFile) {
    if (skippedBinary) {
      throw createToolError(
        TOOL_ERROR_CODES.searchFilesUnsearchable,
        `'${singleScopedFile}' is a binary file and cannot be searched. Use file-read to inspect it.`,
      );
    }
    throw createToolError(
      TOOL_ERROR_CODES.searchFilesNoMatch,
      `No matches found in '${singleScopedFile}'. Try file-read to inspect the file directly.`,
    );
  }
  return "No matches.";
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function readFileContent(
  workspace: string,
  path: string,
  options: FileReadOptions = {},
): Promise<FileReadResult> {
  const absPath = ensurePathWithinSandbox(path, workspace);
  const { offset, limit } = options;
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 1)) {
    throw createToolError(TOOL_ERROR_CODES.readFileRangeInvalid, `offset must be a line number >= 1, got ${offset}.`);
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw createToolError(TOOL_ERROR_CODES.readFileRangeInvalid, `limit must be a line count >= 1, got ${limit}.`);
  }
  const { size } = await stat(absPath);
  if (size > FILE_READ_MAX_BYTES) {
    throw createToolError(
      TOOL_ERROR_CODES.readFileTooLarge,
      `File "${path}" is ${formatMegabytes(size)}, over the ${formatMegabytes(FILE_READ_MAX_BYTES)} byte ceiling, so no range of it can be read. Search it with file-search instead.`,
    );
  }
  const raw = await readFile(absPath, "utf8");
  const lines = raw.split("\n");
  // A trailing newline terminates the last line rather than starting another one, and the
  // reported total is a promise the model checks its own reads against.
  if (lines[lines.length - 1] === "") lines.pop();
  const totalLines = lines.length;
  if (offset !== undefined && offset > totalLines) {
    throw createToolError(
      TOOL_ERROR_CODES.readFileRangeInvalid,
      `offset (${offset}) is past the end of "${path}" (${totalLines} lines).`,
    );
  }
  if (totalLines === 0) return { output: `File: ${absPath}\nLines: 0-0 of 0`, totalLines: 0, startLine: 0, endLine: 0 };
  const startLine = offset ?? 1;
  const endLine = limit === undefined ? totalLines : Math.min(startLine + limit - 1, totalLines);
  const numbered = lines.slice(startLine - 1, endLine).map((line, idx) => `${startLine + idx}: ${line}`);
  const output = [`File: ${absPath}`, `Lines: ${startLine}-${endLine} of ${totalLines}`, ...numbered].join("\n");
  const tokens = estimateTokens(output);
  if (tokens > FILE_READ_MAX_TOKENS) {
    const ranged = offset !== undefined || limit !== undefined;
    throw createToolError(
      TOOL_ERROR_CODES.readFileTooLarge,
      ranged
        ? `Lines ${startLine}-${endLine} of "${path}" are ~${tokens} tokens, over the ${FILE_READ_MAX_TOKENS}-token read ceiling. Narrow the range.`
        : `File "${path}" is ~${tokens} tokens (${totalLines} lines), over the ${FILE_READ_MAX_TOKENS}-token read ceiling. Re-read it with offset and limit to select the lines you need.`,
    );
  }
  return { output, totalLines, startLine, endLine };
}

export async function editFile(input: {
  workspace: string;
  path: string;
  edits: FileEdit[];
  dryRun?: boolean;
}): Promise<string> {
  const absPath = ensurePathWithinSandbox(input.path, input.workspace);
  const raw = await readFile(absPath, "utf8");
  const lines = raw.split("\n");

  // Locate all match ranges in the original text.
  const ranges: Array<{ start: number; end: number; replace: string }> = [];
  for (const edit of input.edits) {
    if ("find" in edit) {
      if (!edit.find) throw new Error("Find text cannot be empty");
      const findLineCount = edit.find.split("\n").length;
      if (findLineCount > MAX_FIND_SNIPPET_LINES || edit.find.length > MAX_FIND_SNIPPET_CHARS) {
        throw createToolError(
          TOOL_ERROR_CODES.editFileFindTooLarge,
          "find must be a short unique snippet (a few lines), not a large portion of the file. Use just enough context to uniquely identify the edit location.",
          undefined,
        );
      }
      const replaceLineCount = edit.replace.split("\n").length;
      if (replaceLineCount > MAX_FIND_REPLACE_LINES || edit.replace.length > MAX_FIND_REPLACE_CHARS) {
        throw createToolError(
          TOOL_ERROR_CODES.editFileReplaceTooLarge,
          "replace must contain only the changed region for a find/replace edit, not a large block or whole-file rewrite. Use a line-range edit for larger replacements.",
          undefined,
        );
      }
      const count = raw.split(edit.find).length - 1;
      if (count === 0) {
        throw createToolError(
          TOOL_ERROR_CODES.editFileFindNotFound,
          `Find text not found in file: ${edit.find.slice(0, 60)}`,
          undefined,
        );
      }
      if (count > 1) {
        const message = `Find text matched ${count} locations (${edit.find.slice(0, 40)}…). Provide a longer, more unique snippet to match exactly one location. For local rewrites in one file, batch unique snippets or use a single line-range edit for one contiguous block. Use code-edit only for structural code changes.`;
        throw createToolError(TOOL_ERROR_CODES.editFileMultiMatch, message, undefined);
      }
      const start = raw.indexOf(edit.find);
      ranges.push({ start, end: start + edit.find.length, replace: edit.replace });
    } else {
      const { startLine, endLine, replace } = edit;
      if (startLine < 1 || endLine < 1) throw new Error("Line numbers must be >= 1");
      if (startLine > endLine) throw new Error(`startLine (${startLine}) must be <= endLine (${endLine})`);
      const clampedEnd = Math.min(endLine, lines.length); // silently clamp — model almost always means "to end of file"
      // `lines` keeps the empty element a trailing newline produces; the guard has to compare
      // against the lines that hold content, which is what a read reported to the model.
      const contentLineCount = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
      if (startLine === 1 && clampedEnd >= contentLineCount && replace.trim().length === 0) {
        throw createToolError(
          TOOL_ERROR_CODES.editFileLineRangeTooLarge,
          "line-range edit would clear the entire file. Use a bounded range edit, or file-delete if the file should be removed.",
          undefined,
        );
      }
      // Convert 1-based inclusive line range to character offsets.
      let charStart = 0;
      for (let i = 0; i < startLine - 1; i++) {
        charStart += (lines[i]?.length ?? 0) + 1;
      }
      let charEnd = charStart;
      for (let i = startLine - 1; i <= clampedEnd - 1; i++) {
        charEnd += (lines[i]?.length ?? 0) + 1;
      }
      // If clampedEnd is the last line and file doesn't end with \n, don't overshoot.
      if (clampedEnd === lines.length && !raw.endsWith("\n")) charEnd -= 1;
      ranges.push({ start: charStart, end: charEnd, replace });
    }
  }

  // Check for overlaps.
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1];
    const curr = ranges[i];
    if (prev && curr && curr.start < prev.end)
      throw new Error("Edit regions overlap. Use fewer, non-overlapping find snippets.");
  }

  const hasFindReplaceEdit = input.edits.some((edit) => "find" in edit);
  const totalTouchedChars = ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
  const totalTouchedLines = ranges.reduce(
    (sum, range) => sum + raw.slice(range.start, range.end).split("\n").length,
    0,
  );
  if (
    (hasFindReplaceEdit || input.edits.length > 1) &&
    (totalTouchedChars > MAX_BATCH_EDIT_CHARS || totalTouchedLines > MAX_BATCH_EDIT_LINES)
  ) {
    throw createToolError(
      TOOL_ERROR_CODES.editFileBatchTooLarge,
      "file-edit batch rewrites too much of the file. Use short bounded snippets for local edits, a single line-range edit for one contiguous block, or code-edit for structural rewrites.",
      undefined,
    );
  }

  // Detect likely duplication: replace text ends with lines that already follow the edit point.
  const DUPLICATION_MIN_LINES = 3;
  for (const r of ranges) {
    const afterRaw = raw.slice(r.end);
    const afterEdit = afterRaw.startsWith("\n") ? afterRaw.slice(1) : afterRaw;
    const replaceLines = r.replace.split("\n");
    const afterLines = afterEdit.split("\n");
    if (replaceLines.length >= DUPLICATION_MIN_LINES && afterLines.length >= DUPLICATION_MIN_LINES) {
      const tail = replaceLines.slice(-DUPLICATION_MIN_LINES);
      const head = afterLines.slice(0, DUPLICATION_MIN_LINES);
      const allMatch = tail.every((line, i) => line === head[i]);
      const nonTrivial = tail.some((line) => line.trim().length > 0);
      if (allMatch && nonTrivial) {
        throw new Error(
          "Replace text ends with lines that already follow the edit point — this would duplicate content. Only include the new/changed lines in replace, not the surrounding context.",
        );
      }
    }
  }

  // Apply in reverse order to preserve offsets.
  let next = raw;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    if (r) next = next.slice(0, r.start) + r.replace + next.slice(r.end);
  }

  if (!input.dryRun) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, next, "utf8");
  }

  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = await createDiff({ displayPath: relativePath, previous: raw, next });
  return [
    `path=${absPath}`,
    `edits=${input.edits.length}`,
    `dry_run=${input.dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}

export async function writeTextFile(input: { workspace: string; path: string; content: string }): Promise<string> {
  const absPath = ensurePathWithinSandbox(input.path, input.workspace);
  let previousContent: string | null = null;

  try {
    previousContent = await readFile(absPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) throw error;
  }

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, input.content, "utf8");
  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = await createDiff({ displayPath: relativePath, previous: previousContent, next: input.content });
  const parts = [
    `path=${absPath}`,
    `bytes=${Buffer.byteLength(input.content, "utf8")}`,
    `overwritten=${previousContent !== null ? "true" : "false"}`,
    "",
    diff,
  ];
  return parts.join("\n");
}

export async function deleteTextFile(input: { workspace: string; path: string; dryRun?: boolean }): Promise<string> {
  const absPath = ensurePathWithinSandbox(input.path, input.workspace);
  const previousContent = await readFile(absPath, "utf8");
  const dryRun = input.dryRun ?? false;
  if (!dryRun) await unlink(absPath);
  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = await createDiff({ displayPath: relativePath, previous: previousContent, next: null });
  return [
    `path=${absPath}`,
    `bytes=${Buffer.byteLength(previousContent, "utf8")}`,
    `dry_run=${dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}
