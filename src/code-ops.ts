import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as napi from "@ast-grep/napi";
import { invariant } from "./assert";
import { createToolError, type EditCodeRecoveryKind, TOOL_ERROR_CODES, type ToolRecovery } from "./error-primitives";
import { createDiff, displayPathForDiff, ensurePathWithinAllowedRoots, IGNORED_DIRS } from "./tool-utils";

function editCodeRecovery(path: string, kind: EditCodeRecoveryKind): ToolRecovery {
  switch (kind) {
    case "use-supported-file":
      return {
        tool: "edit-code",
        kind,
        summary: "edit-code only works on supported code files.",
        instruction: `Switch to a supported code file for edit-code when changing '${path}', or use edit-file if this is a plain-text rewrite.`,
      };
    case "refine-pattern":
      return {
        tool: "edit-code",
        kind,
        summary: "Your AST pattern did not match the current file.",
        instruction:
          `Keep the change in '${path}' and refine the ast-grep pattern to match the actual syntax in the latest read-file output. ` +
          "Do not switch to plain-text snippets unless you are changing to edit-file.",
      };
    case "fix-replacement":
      return {
        tool: "edit-code",
        kind,
        summary: "Your edit-code replacement shape is invalid for this pattern.",
        instruction:
          `Keep the change in '${path}' and fix the replacement to use only metavariables captured by the pattern. ` +
          "If the rewrite needs variadic or plain-text editing, switch to edit-file.",
      };
    default:
      return kind satisfies never;
  }
}

function scanCodeRecovery(path: string): ToolRecovery {
  return {
    tool: "scan-code",
    kind: "use-supported-file",
    summary: "scan-code only works on supported code files.",
    instruction: `Use scan-code on a supported code file or directory when scanning '${path}', or switch to search-files for plain-text lookup.`,
  };
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

function languageFromPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return undefined;
  return LANGUAGE_MAP[filePath.slice(dot).toLowerCase()];
}

function isParseable(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 && filePath.slice(dot).toLowerCase() in LANGUAGE_MAP;
}

function extractMetavariables(pattern: string): string[] {
  const matches = pattern.match(/\${1,3}[A-Z_][A-Z0-9_]*/g);
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
  if (!isParseable(absPath)) {
    throw createToolError(
      TOOL_ERROR_CODES.editCodeUnsupportedFile,
      `edit-code requires a supported code file, got: ${input.path}`,
      undefined,
      editCodeRecovery(input.path, "use-supported-file"),
    );
  }
  const original = await readFile(absPath, "utf8");
  await ensureDynamicLanguages();

  const langName = languageFromPath(absPath);
  const langEnum = napi.Lang[langName as keyof typeof napi.Lang];
  let current = original;
  let totalMatches = 0;

  for (const edit of input.edits) {
    const tree = napi.parse(langEnum ?? langName, current);
    const matches = tree.root().findAll({ rule: { pattern: edit.pattern } });
    if (matches.length === 0) {
      throw createToolError(
        TOOL_ERROR_CODES.editCodeNoMatch,
        `No AST matches found for pattern: ${edit.pattern}`,
        undefined,
        editCodeRecovery(input.path, "refine-pattern"),
      );
    }
    totalMatches += matches.length;

    const patternMetavars = extractMetavariables(edit.pattern);
    const replacementMetavars = extractMetavariables(edit.replacement);
    const variadicReplacementMetavars = replacementMetavars.filter((metavar) => metavar.startsWith("$$$"));
    if (variadicReplacementMetavars.length > 0) {
      throw createToolError(
        TOOL_ERROR_CODES.editCodeVariadicReplacement,
        `edit-code does not support variadic replacement metavariables: ${variadicReplacementMetavars.join(", ")}. Use edit-file for this rewrite.`,
        undefined,
        editCodeRecovery(input.path, "fix-replacement"),
      );
    }
    const unknownReplacementMetavars = replacementMetavars.filter((metavar) => !patternMetavars.includes(metavar));
    if (unknownReplacementMetavars.length > 0) {
      throw createToolError(
        TOOL_ERROR_CODES.editCodeReplacementMetaMismatch,
        `Replacement references metavariables not present in pattern: ${unknownReplacementMetavars.join(", ")}`,
        undefined,
        editCodeRecovery(input.path, "fix-replacement"),
      );
    }
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    for (const match of matches) {
      let replaced = edit.replacement;
      for (const metavar of replacementMetavars) {
        const captured = match.getMatch(metavar.replace(/^\$+/, ""));
        if (!captured) {
          throw new Error(`Could not resolve metavariable ${metavar} from pattern: ${edit.pattern}`);
        }
        replaced = replaced.replaceAll(metavar, captured.text());
      }
      const range = match.range();
      replacements.push({ start: range.start.index, end: range.end.index, replacement: replaced });
    }

    replacements.sort((a, b) => b.start - a.start);
    for (const replacement of replacements) {
      current = current.slice(0, replacement.start) + replacement.replacement + current.slice(replacement.end);
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
  const results: PatternResult[] = patterns.map((pattern) => ({ pattern, matches: [] }));

  const totalMatches = () => results.reduce((sum, result) => sum + result.matches.length, 0);

  const scanFile = (relPath: string, content: string, lang: string): void => {
    const langEnum = napi.Lang[lang as keyof typeof napi.Lang];
    let tree: ReturnType<typeof napi.parse>;
    try {
      tree = napi.parse(langEnum ?? lang, content);
    } catch {
      return;
    }
    for (const result of results) {
      if (totalMatches() >= maxResults) return;
      const metavars = extractMetavariables(result.pattern);
      const found = tree.root().findAll({ rule: { pattern: result.pattern } });
      for (const match of found) {
        if (totalMatches() >= maxResults) return;
        const range = match.range();
        const text = match.text().split("\n")[0] ?? "";
        const captures: Record<string, string> = {};
        for (const metavar of metavars) {
          const captured = match.getMatch(metavar.slice(1));
          if (captured) captures[metavar] = captured.text();
        }
        result.matches.push({ relPath, line: range.start.line + 1, text, captures });
      }
    }
  };

  let scanned = 0;

  const scanPath = async (rawPath: string) => {
    const absPath = ensurePathWithinAllowedRoots(rawPath, "Scan", input.workspace);
    const info = await stat(absPath);

    if (info.isFile()) {
      if (!input.language && !isParseable(absPath)) {
        throw createToolError(
          TOOL_ERROR_CODES.scanCodeUnsupportedFile,
          `scan-code requires a supported code file, got: ${rawPath}`,
          undefined,
          scanCodeRecovery(rawPath),
        );
      }
      const content = await readFile(absPath, "utf8");
      const lang = input.language ?? languageFromPath(absPath);
      invariant(lang, `scan-code requires a supported code file, got: ${rawPath}`);
      scanned++;
      scanFile(displayPathForDiff(absPath, input.workspace), content, lang);
      return;
    }

    if (!info.isDirectory()) {
      throw new Error(`Path is not a file or directory: ${absPath}`);
    }

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
          continue;
        }
        if (!entry.isFile() || !isParseable(abs)) continue;
        if (scanned >= maxFiles || totalMatches() >= maxResults) break;
        const lang = input.language ?? languageFromPath(abs);
        if (!lang) continue;
        try {
          const content = await readFile(abs, "utf8");
          scanned++;
          scanFile(displayPathForDiff(abs, input.workspace), content, lang);
        } catch {
          /* skip unreadable files */
        }
      }
    }
  };

  for (const path of input.paths) {
    if (totalMatches() >= maxResults) break;
    await scanPath(path);
  }

  const total = totalMatches();
  const lines: string[] = [`scanned=${scanned} matches=${total}`];
  const multi = patterns.length > 1;
  for (const result of results) {
    if (multi) lines.push(`--- pattern: ${result.pattern} ---`);
    for (const match of result.matches) {
      const truncated = match.text.length > 80 ? `${match.text.slice(0, 77)}...` : match.text;
      const captureStr =
        Object.keys(match.captures).length > 0
          ? `  {${Object.entries(match.captures)
              .map(([key, value]) => `${key}=${value}`)
              .join(", ")}}`
          : "";
      lines.push(`${match.relPath}:${match.line}: ${truncated}${captureStr}`);
    }
    if (multi && result.matches.length === 0) lines.push("No matches.");
  }
  if (!multi && total === 0) lines.push("No matches.");
  return lines.join("\n");
}
