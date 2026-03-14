import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as napi from "@ast-grep/napi";
import { invariant } from "./assert";
import type {
  EditCodeEdit,
  EditCodePattern,
  EditCodeRelationalRule,
  EditCodeRenameEdit,
  EditCodeRule,
  EditCodeRuleObject,
} from "./code-contract";
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
        nextTool: "edit-file",
        targetPaths: [path],
      };
    case "refine-pattern":
      return {
        tool: "edit-code",
        kind,
        summary: "Your AST pattern did not match the current file.",
        instruction:
          `Keep the change in '${path}' and refine the ast-grep pattern to match the actual syntax in the latest read-file output. ` +
          'For a helper-scoped variable rename, prefer a structured rename edit like { op: "rename", from, to, withinSymbol } instead of broadening to a larger pattern. ' +
          "Do not switch to plain-text snippets unless you are changing to edit-file.",
        nextTool: "read-file",
        targetPaths: [path],
      };
    case "fix-replacement":
      return {
        tool: "edit-code",
        kind,
        summary: "Your edit-code replacement shape is invalid for this pattern.",
        instruction:
          `Keep the change in '${path}' and fix the replacement to use only metavariables captured by the pattern. ` +
          "If the rewrite needs variadic or plain-text editing, switch to edit-file.",
        nextTool: "edit-code",
        targetPaths: [path],
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
    nextTool: "search-files",
    targetPaths: [path],
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

function resolveReplacementMetavariable(match: napi.SgNode, metavar: string, source: string): string {
  const name = metavar.replace(/^\$+/, "");
  if (metavar.startsWith("$$$")) {
    const captures = match.getMultipleMatches(name);
    if (captures.length === 0) return "";
    const first = captures[0];
    const last = captures[captures.length - 1];
    if (!first || !last) return "";
    const start = first.range().start.index;
    const end = last.range().end.index;
    return source.slice(start, end);
  }
  const captured = match.getMatch(name);
  if (!captured) throw new Error(`Could not resolve metavariable ${metavar}`);
  return captured.text();
}

function nodeHasWithinSymbol(node: napi.SgNode, symbol: string): boolean {
  if (node.kind() === "class_declaration") {
    const name = node.field("name");
    return name?.text() === symbol;
  }
  if (node.kind() === "function_declaration") {
    const name = node.field("name");
    return name?.text() === symbol;
  }
  if (node.kind() === "method_definition") {
    const name = node.field("name");
    return name?.text() === symbol;
  }
  if (node.kind() === "variable_declarator") {
    const name = node.field("name");
    return name?.text() === symbol;
  }
  return false;
}

function matchIsWithinSymbol(match: napi.SgNode, symbol: string): boolean {
  let current: napi.SgNode | null = match;
  while (current) {
    if (nodeHasWithinSymbol(current, symbol)) return true;
    current = current.parent();
  }
  return false;
}

function isRenameEdit(edit: EditCodeEdit): edit is EditCodeRenameEdit {
  return edit.op === "rename";
}

function patternSourceText(pattern: EditCodePattern): string {
  return typeof pattern === "string" ? pattern : pattern.context;
}

function patternLabel(pattern: EditCodePattern): string {
  if (typeof pattern === "string") return pattern;
  return `${pattern.context}${pattern.selector ? ` selector: ${pattern.selector}` : ""}${pattern.strictness ? ` strictness: ${pattern.strictness}` : ""}`;
}

function isPatternObject(
  value: EditCodeRule | EditCodeRelationalRule | EditCodePattern,
): value is Exclude<EditCodePattern, string> {
  return typeof value === "object" && value !== null && "context" in value;
}

function isRuleObject(
  value: EditCodeRule | EditCodeRelationalRule,
): value is EditCodeRuleObject | EditCodeRelationalRule {
  return typeof value === "object" && value !== null && !("context" in value) && !("rule" in value);
}

function compilePattern(pattern: EditCodePattern): string | Record<string, unknown> {
  if (typeof pattern === "string") return pattern;
  return {
    context: pattern.context,
    ...(pattern.selector ? { selector: pattern.selector } : {}),
    ...(pattern.strictness ? { strictness: pattern.strictness } : {}),
  };
}

function compileRelationalRule(rule: EditCodeRelationalRule): Record<string, unknown> {
  return {
    ...compileRule(rule),
    ...(rule.field ? { field: rule.field } : {}),
    ...(rule.stopBy ? { stopBy: typeof rule.stopBy === "string" ? rule.stopBy : compileRule(rule.stopBy) } : {}),
  };
}

function compileRule(rule: EditCodeRule | EditCodeRelationalRule): Record<string, unknown> {
  if (typeof rule === "string" || isPatternObject(rule)) {
    return { pattern: compilePattern(rule) };
  }
  invariant(isRuleObject(rule), "edit-code rule must compile from a rule object");
  return {
    ...(rule.pattern !== undefined ? { pattern: compilePattern(rule.pattern) } : {}),
    ...(rule.kind ? { kind: rule.kind } : {}),
    ...(rule.regex ? { regex: rule.regex } : {}),
    ...(rule.inside ? { inside: compileRelationalRule(rule.inside) } : {}),
    ...(rule.has ? { has: compileRelationalRule(rule.has) } : {}),
    ...(rule.all ? { all: rule.all.map(compileRule) } : {}),
    ...(rule.any ? { any: rule.any.map(compileRule) } : {}),
    ...(rule.not ? { not: compileRule(rule.not) } : {}),
  };
}

function ruleLabel(rule: EditCodeRule): string {
  if (typeof rule === "string") return rule;
  if (isPatternObject(rule)) return patternLabel(rule);
  return JSON.stringify(rule);
}

function collectRulePatternSources(rule: EditCodeRule | EditCodeRelationalRule): string[] {
  if (typeof rule === "string") return [rule];
  if (isPatternObject(rule)) return [patternSourceText(rule)];
  invariant(isRuleObject(rule), "edit-code rule must collect pattern sources from a rule object");
  const out: string[] = [];
  if (rule.pattern !== undefined) out.push(...collectRulePatternSources(rule.pattern));
  if (rule.inside) out.push(...collectRulePatternSources(rule.inside));
  if (rule.has) out.push(...collectRulePatternSources(rule.has));
  if (rule.all) for (const child of rule.all) out.push(...collectRulePatternSources(child));
  if (rule.any) for (const child of rule.any) out.push(...collectRulePatternSources(child));
  if (rule.not) out.push(...collectRulePatternSources(rule.not));
  if ("stopBy" in rule && rule.stopBy && typeof rule.stopBy !== "string") {
    out.push(...collectRulePatternSources(rule.stopBy));
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renameRule(from: string): Record<string, unknown> {
  return {
    any: [
      { all: [{ kind: "identifier" }, { regex: `^${escapeRegex(from)}$` }] },
      { all: [{ kind: "property_identifier" }, { regex: `^${escapeRegex(from)}$` }] },
    ],
  };
}

export type EditCodeResult = {
  path: string;
  edits: number;
  matches: number;
  diff: string;
  output: string;
};

export async function editCode(input: {
  workspace: string;
  path: string;
  edits: EditCodeEdit[];
}): Promise<EditCodeResult> {
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
    const pattern = isRenameEdit(edit) ? edit.from : ruleLabel(edit.rule);
    const replacement = isRenameEdit(edit) ? edit.to : edit.replacement;
    const allMatches = tree
      .root()
      .findAll(isRenameEdit(edit) ? { rule: renameRule(pattern) } : { rule: compileRule(edit.rule) });
    let matches = allMatches;
    if (edit.within) {
      const scopes = tree.root().findAll({ rule: { pattern: edit.within } });
      matches = allMatches.filter((match) => {
        const range = match.range();
        return scopes.some((scope) => {
          const scopeRange = scope.range();
          return scopeRange.start.index <= range.start.index && scopeRange.end.index >= range.end.index;
        });
      });
    }
    if (edit.withinSymbol) {
      const symbol = edit.withinSymbol;
      matches = matches.filter((match) => matchIsWithinSymbol(match, symbol));
    }
    if (matches.length === 0) {
      throw createToolError(
        TOOL_ERROR_CODES.editCodeNoMatch,
        `No AST matches found for pattern: ${pattern}${edit.within ? ` within: ${edit.within}` : ""}${edit.withinSymbol ? ` withinSymbol: ${edit.withinSymbol}` : ""}`,
        undefined,
        editCodeRecovery(input.path, "refine-pattern"),
      );
    }
    totalMatches += matches.length;

    const patternMetavars = isRenameEdit(edit)
      ? []
      : Array.from(new Set(collectRulePatternSources(edit.rule).flatMap((source) => extractMetavariables(source))));
    const replacementMetavars = isRenameEdit(edit) ? [] : extractMetavariables(edit.replacement);
    if (!isRenameEdit(edit)) {
      const unknownReplacementMetavars = replacementMetavars.filter((metavar) => !patternMetavars.includes(metavar));
      if (unknownReplacementMetavars.length > 0) {
        throw createToolError(
          TOOL_ERROR_CODES.editCodeReplacementMetaMismatch,
          `Replacement references metavariables not present in pattern: ${unknownReplacementMetavars.join(", ")}`,
          undefined,
          editCodeRecovery(input.path, "fix-replacement"),
        );
      }
    }
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    for (const match of matches) {
      let replaced = replacement;
      for (const metavar of replacementMetavars) {
        replaced = replaced.replaceAll(metavar, resolveReplacementMetavariable(match, metavar, current));
      }
      const range = match.range();
      replacements.push({ start: range.start.index, end: range.end.index, replacement: replaced });
    }

    replacements.sort((a, b) => b.start - a.start);
    for (const replacement of replacements) {
      current = current.slice(0, replacement.start) + replacement.replacement + current.slice(replacement.end);
    }
  }

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, current, "utf8");

  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = createDiff(relativePath, original, current);
  const output = [`path=${absPath}`, `edits=${input.edits.length}`, `matches=${totalMatches}`, "", diff].join("\n");
  return {
    path: absPath,
    edits: input.edits.length,
    matches: totalMatches,
    diff,
    output,
  };
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
