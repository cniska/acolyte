import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as napi from "@ast-grep/napi";
import { createToolError, TOOL_ERROR_CODES } from "./tool-error-codes";
import {
  collectWorkspaceFiles,
  createDiff,
  createUnifiedDeleteDiff,
  displayPathForDiff,
  ensurePathWithinAllowedRoots,
  IGNORED_DIRS,
  isBinaryExtension,
  resolveSearchScopeFiles,
  toInt,
} from "./tool-utils";

export type FindReplaceEdit = { find: string; replace: string };
export type LineRangeEdit = { startLine: number; endLine: number; replace: string };
export type FileEdit = FindReplaceEdit | LineRangeEdit;

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
  const allFiles = await resolveSearchScopeFiles(workspace, paths);
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

  return matches.length > 0 ? matches.join("\n") : "No matches.";
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
      if (edit.find.length > raw.length * 0.5) {
        throw new Error(
          "find must be a short unique snippet (a few lines), not a large portion of the file. Use just enough context to uniquely identify the edit location.",
        );
      }
      const count = raw.split(edit.find).length - 1;
      if (count === 0) throw new Error(`Find text not found in file: ${edit.find.slice(0, 60)}`);
      if (count > 1) {
        const message = `Find text matched ${count} locations (${edit.find.slice(0, 40)}…). Provide a longer, more unique snippet to match exactly one location, or use edit-code for multi-location code changes.`;
        throw createToolError(TOOL_ERROR_CODES.editFileMultiMatch, message);
      }
      const start = raw.indexOf(edit.find);
      ranges.push({ start, end: start + edit.find.length, replace: edit.replace });
    } else {
      const { startLine, endLine, replace } = edit;
      if (startLine < 1 || endLine < 1) throw new Error("Line numbers must be >= 1");
      if (startLine > endLine) throw new Error(`startLine (${startLine}) must be <= endLine (${endLine})`);
      const clampedEnd = Math.min(endLine, lines.length);
      if (clampedEnd !== endLine) {
        // Silently clamp — the model almost always means "to end of file".
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
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) {
      if (error instanceof Error && error.message === "Target file already exists") throw error;
      throw error;
    }
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

let dynamicLangsRegistered = false;

async function ensureDynamicLanguages(): Promise<void> {
  if (dynamicLangsRegistered) return;
  const langs: Record<string, unknown> = {};
  try {
    const { default: python } = await import("@ast-grep/lang-python");
    langs.python = python;
  } catch {
    /* optional */
  }
  try {
    const { default: rust } = await import("@ast-grep/lang-rust");
    langs.rust = rust;
  } catch {
    /* optional */
  }
  try {
    const { default: go } = await import("@ast-grep/lang-go");
    langs.go = go;
  } catch {
    /* optional */
  }
  if (Object.keys(langs).length > 0) {
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep dynamic language API has loose types
    napi.registerDynamicLanguage(langs as any);
  }
  dynamicLangsRegistered = true;
}

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "Tsx",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".html": "Html",
  ".css": "Css",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
};

function languageFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "TypeScript";
  return LANGUAGE_MAP[filePath.slice(dot).toLowerCase()] ?? "TypeScript";
}

function isParseable(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 && filePath.slice(dot).toLowerCase() in LANGUAGE_MAP;
}

function extractMetavariables(pattern: string): string[] {
  const matches = pattern.match(/\$[A-Z_][A-Z0-9_]*/g);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

export async function editCode(input: {
  workspace: string;
  path: string;
  edits: Array<{ pattern: string; replacement: string }>;
  dryRun?: boolean;
}): Promise<string> {
  const absPath = ensurePathWithinAllowedRoots(input.path, "AST edit", input.workspace);
  const pathStats = await stat(absPath);
  if (!pathStats.isFile()) throw new Error(`edit-code requires a file path, got: ${input.path}`);
  const original = await readFile(absPath, "utf8");
  await ensureDynamicLanguages();

  const langName = languageFromPath(absPath);
  const langEnum = napi.Lang[langName as keyof typeof napi.Lang];
  let current = original;
  let totalMatches = 0;

  // Apply each pattern sequentially (reparse between patterns).
  for (const edit of input.edits) {
    const tree = napi.parse(langEnum ?? langName, current);
    const matches = tree.root().findAll({ rule: { pattern: edit.pattern } });
    if (matches.length === 0) throw new Error(`No AST matches found for pattern: ${edit.pattern}`);
    totalMatches += matches.length;

    const metavars = extractMetavariables(edit.pattern);
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    for (const match of matches) {
      let replaced = edit.replacement;
      for (const metavar of metavars) {
        const captured = match.getMatch(metavar.slice(1));
        if (captured) replaced = replaced.replaceAll(metavar, captured.text());
      }
      const range = match.range();
      replacements.push({ start: range.start.index, end: range.end.index, replacement: replaced });
    }

    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      current = current.slice(0, r.start) + r.replacement + current.slice(r.end);
    }
  }

  if (!input.dryRun) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, current, "utf8");
  }

  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = createDiff(relativePath, original, current);
  return [
    `path=${absPath}`,
    `edits=${input.edits.length}`,
    `matches=${totalMatches}`,
    `dry_run=${input.dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
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

export async function scanCode(input: {
  workspace: string;
  paths: string[];
  pattern: string | string[];
  language?: string;
  maxResults?: number;
}): Promise<string> {
  const maxResults = input.maxResults ?? 50;
  const patterns = Array.isArray(input.pattern) ? input.pattern : [input.pattern];

  await ensureDynamicLanguages();

  type Match = { relPath: string; line: number; text: string; captures: Record<string, string> };
  type PatternResult = { pattern: string; matches: Match[] };
  const results: PatternResult[] = patterns.map((p) => ({ pattern: p, matches: [] }));

  const totalMatches = () => results.reduce((sum, r) => sum + r.matches.length, 0);

  const scanFile = (relPath: string, content: string, lang: string): void => {
    const langEnum = napi.Lang[lang as keyof typeof napi.Lang];
    let tree: ReturnType<typeof napi.parse>;
    try {
      tree = napi.parse(langEnum ?? lang, content);
    } catch {
      return; // skip unparseable files
    }
    for (const pr of results) {
      if (totalMatches() >= maxResults) return;
      const metavars = extractMetavariables(pr.pattern);
      const found = tree.root().findAll({ rule: { pattern: pr.pattern } });
      for (const m of found) {
        if (totalMatches() >= maxResults) return;
        const range = m.range();
        const text = m.text().split("\n")[0] ?? "";
        const captures: Record<string, string> = {};
        for (const mv of metavars) {
          const captured = m.getMatch(mv.slice(1));
          if (captured) captures[mv] = captured.text();
        }
        pr.matches.push({ relPath, line: range.start.line + 1, text, captures });
      }
    }
  };

  let scanned = 0;

  const scanPath = async (rawPath: string) => {
    const absPath = ensurePathWithinAllowedRoots(rawPath, "Scan", input.workspace);
    const info = await stat(absPath);

    if (info.isFile()) {
      const content = await readFile(absPath, "utf8");
      const lang = input.language ?? languageFromPath(absPath);
      scanned++;
      scanFile(displayPathForDiff(absPath, input.workspace), content, lang);
    } else if (info.isDirectory()) {
      const { readdir } = await import("node:fs/promises");
      const stack: string[] = [absPath];
      const maxFiles = 500;
      while (stack.length > 0 && scanned < maxFiles && totalMatches() < maxResults) {
        const dir = stack.pop();
        if (!dir) break;
        let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.name.startsWith(".") && entry.isDirectory()) continue;
          if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
          const abs = join(dir, entry.name);
          if (entry.isDirectory()) {
            stack.push(abs);
          } else if (entry.isFile() && isParseable(abs)) {
            if (scanned >= maxFiles || totalMatches() >= maxResults) break;
            const lang = input.language ?? languageFromPath(abs);
            try {
              const content = await readFile(abs, "utf8");
              scanned++;
              scanFile(displayPathForDiff(abs, input.workspace), content, lang);
            } catch {
              /* skip unreadable files */
            }
          }
        }
      }
    } else {
      throw new Error(`Path is not a file or directory: ${absPath}`);
    }
  };

  for (const p of input.paths) {
    if (totalMatches() >= maxResults) break;
    await scanPath(p);
  }

  const total = totalMatches();
  const lines: string[] = [`scanned=${scanned} matches=${total}`];
  const multi = patterns.length > 1;
  for (const pr of results) {
    if (multi) lines.push(`--- pattern: ${pr.pattern} ---`);
    for (const m of pr.matches) {
      const truncated = m.text.length > 80 ? `${m.text.slice(0, 77)}...` : m.text;
      const captureStr =
        Object.keys(m.captures).length > 0
          ? `  {${Object.entries(m.captures)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}}`
          : "";
      lines.push(`${m.relPath}:${m.line}: ${truncated}${captureStr}`);
    }
    if (multi && pr.matches.length === 0) lines.push("No matches.");
  }
  if (!multi && total === 0) lines.push("No matches.");
  return lines.join("\n");
}
