import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { createToolError } from "./tool-error";
import type { EditFileRecoveryKind, SearchFilesRecoveryKind, ToolRecovery } from "./tool-recovery";

/** Owner-only read/write. Use for files containing secrets or sensitive metadata. */
export const PRIVATE_FILE_MODE = 0o600;

import {
  collectWorkspaceFiles,
  createDiff,
  createUnifiedDeleteDiff,
  displayPathForDiff,
  ensurePathWithinAllowedRoots,
  isBinaryExtension,
  resolveSearchScopeFiles,
  toInt,
} from "./tool-utils";

export type FindReplaceEdit = { find: string; replace: string };
export type LineRangeEdit = { startLine: number; endLine: number; replace: string };
export type FileEdit = FindReplaceEdit | LineRangeEdit;

const MAX_FIND_SNIPPET_LINES = 8;
const MAX_FIND_SNIPPET_CHARS = 500;
const MAX_FIND_REPLACE_LINES = 24;
const MAX_FIND_REPLACE_CHARS = 1600;
const MAX_BATCH_EDIT_LINES = 32;
const MAX_BATCH_EDIT_CHARS = 2400;

function editFileRecovery(path: string, kind: EditFileRecoveryKind): ToolRecovery {
  switch (kind) {
    case "disambiguate-match":
      return {
        tool: "edit-file",
        kind,
        summary: "Your edit-file snippet matched multiple locations.",
        instruction:
          `Keep the change in '${path}' and make one bounded edit with a more unique snippet or a single line-range edit. ` +
          "If the rewrite is genuinely structural, switch to edit-code with a real ast-grep pattern.",
        nextTool: "read-file",
        targetPaths: [path],
      };
    case "refresh-snippet":
      return {
        tool: "edit-file",
        kind,
        summary: "Your edit-file find snippet no longer matches the file.",
        instruction:
          `Keep the change in '${path}' and rebuild the next edit from the latest read-file output or use a bounded line-range edit. ` +
          "Do not retry the same stale find text.",
        nextTool: "read-file",
        targetPaths: [path],
      };
    case "shrink-edit":
      return {
        tool: "edit-file",
        kind,
        summary: "Your edit-file request was too large for a bounded edit.",
        instruction:
          `Keep the change in '${path}' and shrink it: use short unique find snippets, a bounded line-range edit covering only the changed region, or use edit-code for a structural rewrite. ` +
          "Do not pass large file blocks as find or replacement text.",
        nextTool: "read-file",
        targetPaths: [path],
      };
    default:
      return kind satisfies never;
  }
}

function searchFilesRecovery(kind: SearchFilesRecoveryKind, targetPaths?: string[]): ToolRecovery {
  switch (kind) {
    case "broaden-scope":
      return {
        tool: "search-files",
        kind,
        summary: "Your search-files scope resolved to no searchable files.",
        instruction:
          "If you already know the exact file, read it directly. Otherwise broaden the scope or use find-files to locate the target file before searching again.",
        nextTool: "find-files",
        resolvesOn: [{ tool: "find-files" }],
      };
    case "switch-to-read":
      return {
        tool: "search-files",
        kind,
        summary: "Your search-files query found no matches in the scoped file.",
        instruction:
          "If the file is still the right target, switch to read-file and inspect the current text directly before deciding the next edit or search.",
        nextTool: "read-file",
        ...(targetPaths && targetPaths.length > 0 ? { targetPaths } : {}),
        resolvesOn: [
          {
            tool: "read-file",
            ...(targetPaths && targetPaths.length > 0 ? { targetPaths } : {}),
          },
        ],
      };
    default:
      return kind satisfies never;
  }
}

export async function findFiles(workspace: string, patterns: string[], maxResults = 40): Promise<string> {
  if (patterns.length === 0) throw new Error("At least one pattern is required");
  const allFiles = await collectWorkspaceFiles(workspace);
  const multi = patterns.length > 1;
  const sections: string[] = [];

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    const needle = trimmed
      .replace(/^\.\/+/, "")
      .replace(/[*?]+/g, "")
      .toLowerCase();

    const ranked = allFiles
      .filter((path) => path.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aScore = aLower === needle ? 0 : aLower.endsWith(`/${needle}`) ? 1 : 2;
        const bScore = bLower === needle ? 0 : bLower.endsWith(`/${needle}`) ? 1 : 2;
        if (aScore !== bScore) return aScore - bScore;
        return a.length - b.length;
      })
      .slice(0, maxResults)
      .map((path) => `./${path}`);

    if (multi) sections.push(`--- ${trimmed} ---`);
    sections.push(ranked.length > 0 ? ranked.join("\n") : "No matches.");
  }

  return sections.join("\n");
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
      `search-files scope resolved to no files: ${normalizedPaths.join(", ")}`,
      undefined,
      searchFilesRecovery("broaden-scope"),
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

  for (const relPath of allFiles) {
    if (matches.length >= maxResults) break;
    if (isBinaryExtension(relPath)) continue;
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
        if (matches.length >= maxResults) break;
      }
    }
  }

  if (matches.length > 0) return matches.join("\n");
  if (singleScopedFile) {
    throw createToolError(
      TOOL_ERROR_CODES.searchFilesNoMatch,
      `search-files found no matches in scoped file: ${singleScopedFile}`,
      undefined,
      searchFilesRecovery("switch-to-read", [singleScopedFile]),
    );
  }
  return "No matches.";
}

export async function readSnippet(workspace: string, pathInput: string, start?: string, end?: string): Promise<string> {
  const absPath = ensurePathWithinAllowedRoots(pathInput, "Read", workspace);
  const raw = await readFile(absPath, "utf8");
  const lines = raw.split("\n");

  const from = toInt(start, 1);
  const to = Math.max(from, toInt(end, Math.min(from + 119, lines.length)));
  const slice = lines.slice(from - 1, to);
  const numbered = slice.map((line, idx) => `${from + idx}: ${line}`);

  return [`File: ${absPath}`, ...numbered].join("\n");
}

export async function readSnippets(
  workspace: string,
  entries: Array<{ path: string; start?: string; end?: string }>,
): Promise<string> {
  const results: string[] = [];
  for (const entry of entries) {
    results.push(await readSnippet(workspace, entry.path, entry.start, entry.end));
  }
  return results.join("\n\n");
}

export async function editFile(input: {
  workspace: string;
  path: string;
  edits: FileEdit[];
  dryRun?: boolean;
}): Promise<string> {
  const absPath = ensurePathWithinAllowedRoots(input.path, "Edit", input.workspace);
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
          editFileRecovery(input.path, "shrink-edit"),
        );
      }
      const replaceLineCount = edit.replace.split("\n").length;
      if (replaceLineCount > MAX_FIND_REPLACE_LINES || edit.replace.length > MAX_FIND_REPLACE_CHARS) {
        throw createToolError(
          TOOL_ERROR_CODES.editFileReplaceTooLarge,
          "replace must contain only the changed region for a find/replace edit, not a large block or whole-file rewrite. Use a line-range edit for larger replacements.",
          undefined,
          editFileRecovery(input.path, "shrink-edit"),
        );
      }
      const count = raw.split(edit.find).length - 1;
      if (count === 0) {
        throw createToolError(
          TOOL_ERROR_CODES.editFileFindNotFound,
          `Find text not found in file: ${edit.find.slice(0, 60)}`,
          undefined,
          editFileRecovery(input.path, "refresh-snippet"),
        );
      }
      if (count > 1) {
        const message =
          `Find text matched ${count} locations (${edit.find.slice(0, 40)}…). ` +
          "Provide a longer, more unique snippet to match exactly one location. " +
          "For local rewrites in one file, batch unique snippets or use a single line-range edit for one contiguous block. " +
          "Use edit-code only for structural code changes.";
        throw createToolError(
          TOOL_ERROR_CODES.editFileMultiMatch,
          message,
          undefined,
          editFileRecovery(input.path, "disambiguate-match"),
        );
      }
      const start = raw.indexOf(edit.find);
      ranges.push({ start, end: start + edit.find.length, replace: edit.replace });
    } else {
      const { startLine, endLine, replace } = edit;
      if (startLine < 1 || endLine < 1) throw new Error("Line numbers must be >= 1");
      if (startLine > endLine) throw new Error(`startLine (${startLine}) must be <= endLine (${endLine})`);
      const clampedEnd = Math.min(endLine, lines.length); // silently clamp — model almost always means "to end of file"
      if (startLine === 1 && clampedEnd === lines.length && replace.trim().length === 0) {
        throw createToolError(
          TOOL_ERROR_CODES.editFileLineRangeTooLarge,
          "line-range edit would clear the entire file. Use a bounded range edit, or delete-file if the file should be removed.",
          undefined,
          editFileRecovery(input.path, "shrink-edit"),
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
      "edit-file batch rewrites too much of the file. Use short bounded snippets for local edits, a single line-range edit for one contiguous block, or edit-code for structural rewrites.",
      undefined,
      editFileRecovery(input.path, "shrink-edit"),
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
  const diff = createDiff(relativePath, raw, next);
  return [
    `path=${absPath}`,
    `edits=${input.edits.length}`,
    `dry_run=${input.dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}

export async function writeTextFile(input: {
  workspace: string;
  path: string;
  content: string;
  overwrite?: boolean;
}): Promise<string> {
  const absPath = ensurePathWithinAllowedRoots(input.path, "Write", input.workspace);
  const overwrite = input.overwrite ?? true;
  let previousContent: string | null = null;

  try {
    previousContent = await readFile(absPath, "utf8");
    if (!overwrite) throw new Error("Target file already exists");
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) throw error;
  }

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, input.content, "utf8");
  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = createDiff(relativePath, previousContent, input.content);
  const parts = [
    `path=${absPath}`,
    `bytes=${Buffer.byteLength(input.content, "utf8")}`,
    `overwritten=${overwrite ? "true" : "false"}`,
    "",
    diff,
  ];
  return parts.join("\n");
}

export async function deleteTextFile(input: { workspace: string; path: string; dryRun?: boolean }): Promise<string> {
  const absPath = ensurePathWithinAllowedRoots(input.path, "Delete", input.workspace);
  const previousContent = await readFile(absPath, "utf8");
  const dryRun = input.dryRun ?? false;
  if (!dryRun) await unlink(absPath);
  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = createUnifiedDeleteDiff(relativePath, previousContent);
  return [
    `path=${absPath}`,
    `bytes=${Buffer.byteLength(previousContent, "utf8")}`,
    `dry_run=${dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}
