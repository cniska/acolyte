import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { TOOL_ERROR_CODES } from "./error-contract";
import { escapeRegex } from "./string-utils";
import { createToolError } from "./tool-error";
import type { EditCodeRecoveryKind, ToolRecovery } from "./tool-recovery";
import { createDiff, displayPathForDiff, ensurePathWithinAllowedRoots, IGNORED_DIRS } from "./tool-utils";

function editCodeRecovery(path: string, kind: EditCodeRecoveryKind): ToolRecovery {
  switch (kind) {
    case "use-supported-file":
      return {
        tool: "code-edit",
        kind,
        summary: "code-edit only works on supported code files.",
        instruction: `Switch to a supported code file for code-edit when changing '${path}', or use file-edit if this is a plain-text rewrite.`,
        nextTool: "file-edit",
        targetPaths: [path],
      };
    case "refine-pattern":
      return {
        tool: "code-edit",
        kind,
        summary: "Your AST pattern did not match the current file.",
        instruction: `Keep the change in '${path}' and refine the ast-grep pattern to match the actual syntax in the latest file-read output. For a helper-scoped variable rename, prefer a structured rename edit like { op: "rename", from, to, withinSymbol } instead of broadening to a larger pattern. Do not switch to plain-text snippets unless you are changing to file-edit.`,
        nextTool: "file-read",
        targetPaths: [path],
      };
    case "clarify-rename-target":
      return {
        tool: "code-edit",
        kind,
        summary: "This scoped rename matches both local and member symbols.",
        instruction: `Keep the change in '${path}' and retry the rename with an explicit target. Use target: "local" to rename the local symbol, or target: "member" to rename the declared member and its this.member references.`,
        nextTool: "code-edit",
        targetPaths: [path],
      };
    case "fix-replacement":
      return {
        tool: "code-edit",
        kind,
        summary: "Your code-edit replacement shape is invalid for this pattern.",
        instruction: `Keep the change in '${path}' and fix the replacement to use only metavariables captured by the pattern. If the rewrite needs variadic or plain-text editing, switch to file-edit.`,
        nextTool: "code-edit",
        targetPaths: [path],
      };
    default:
      return kind satisfies never;
  }
}

function scanCodeRecovery(path: string): ToolRecovery {
  return {
    tool: "code-scan",
    kind: "use-supported-file",
    summary: "code-scan only works on supported code files.",
    instruction: `Use code-scan on a supported code file or directory when scanning '${path}', or switch to file-search for plain-text lookup.`,
    nextTool: "file-search",
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

function extractSymbolName(node: napi.SgNode): string | null {
  const kind = node.kind();
  if (
    kind === "class_declaration" ||
    kind === "function_declaration" ||
    kind === "generator_function_declaration" ||
    kind === "method_definition" ||
    kind === "interface_declaration" ||
    kind === "type_alias_declaration" ||
    kind === "enum_declaration" ||
    kind === "variable_declarator"
  ) {
    return node.field("name")?.text() ?? null;
  }
  if (kind === "function_expression") {
    const name = node.field("name");
    return name ? name.text() : null;
  }
  return null;
}

function nodeHasWithinSymbol(node: napi.SgNode, symbol: string): boolean {
  return extractSymbolName(node) === symbol;
}

function findEnclosingSymbol(node: napi.SgNode): string | null {
  let current: napi.SgNode | null = node.parent();
  while (current) {
    const name = extractSymbolName(current);
    if (name) return name;
    current = current.parent();
  }
  return null;
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
  return typeof value === "object" && value !== null && !("context" in value);
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
  invariant(isRuleObject(rule), "code-edit rule must compile from a rule object");
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
  const parts: string[] = [];
  if (rule.pattern !== undefined) parts.push(`pattern=${ruleLabel(rule.pattern)}`);
  if (rule.kind) parts.push(`kind=${rule.kind}`);
  if (rule.regex) parts.push(`regex=${rule.regex}`);
  if (rule.any) parts.push(`any(${rule.any.length})`);
  if (rule.all) parts.push(`all(${rule.all.length})`);
  if (rule.not) parts.push("not");
  if (rule.inside) parts.push("inside");
  if (rule.has) parts.push("has");
  if ("field" in rule && rule.field) parts.push(`field=${rule.field}`);
  if ("stopBy" in rule && rule.stopBy) parts.push(typeof rule.stopBy === "string" ? `stopBy=${rule.stopBy}` : "stopBy");
  return parts.join(" ") || "rule object";
}

function collectRulePatternSources(rule: EditCodeRule | EditCodeRelationalRule): string[] {
  if (typeof rule === "string") return [rule];
  if (isPatternObject(rule)) return [patternSourceText(rule)];
  invariant(isRuleObject(rule), "code-edit rule must collect pattern sources from a rule object");
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

function renameRule(from: string): Record<string, unknown> {
  return {
    any: [
      { all: [{ kind: "identifier" }, { regex: `^${escapeRegex(from)}$` }] },
      { all: [{ kind: "property_identifier" }, { regex: `^${escapeRegex(from)}$` }] },
      { all: [{ kind: "shorthand_property_identifier" }, { regex: `^${escapeRegex(from)}$` }] },
      { all: [{ kind: "shorthand_property_identifier_pattern" }, { regex: `^${escapeRegex(from)}$` }] },
    ],
  };
}

type RenameMode = "local" | "member" | "text";

function classifyRenameDeclaration(node: napi.SgNode): RenameMode | null {
  const parent = node.parent();
  if (!parent) return null;
  if (node.kind() === "identifier") {
    if (parent.kind() === "variable_declarator") return "local";
    if (
      parent.kind() === "required_parameter" ||
      parent.kind() === "optional_parameter" ||
      parent.kind() === "rest_pattern" ||
      parent.kind() === "formal_parameters" ||
      parent.kind() === "function_declaration"
    ) {
      return "local";
    }
  }
  if (node.kind() === "property_identifier") {
    if (
      parent.kind() === "field_definition" ||
      parent.kind() === "public_field_definition" ||
      parent.kind() === "method_definition"
    ) {
      return "member";
    }
  }
  if (node.kind() === "shorthand_property_identifier_pattern") return "local";
  return null;
}

function resolveRenameMode(matches: napi.SgNode[]): RenameMode {
  let mode: RenameMode | null = null;
  for (const match of matches) {
    const classified = classifyRenameDeclaration(match);
    if (!classified) continue;
    if (!mode) {
      mode = classified;
      continue;
    }
    if (mode !== classified) return "text";
  }
  return mode ?? "text";
}

function hasRenameModeConflict(matches: napi.SgNode[]): boolean {
  let sawLocal = false;
  let sawMember = false;
  for (const match of matches) {
    const classified = classifyRenameDeclaration(match);
    if (classified === "local") sawLocal = true;
    if (classified === "member") sawMember = true;
  }
  return sawLocal && sawMember;
}

function requestedRenameMode(edit: EditCodeRenameEdit): RenameMode | null {
  if (edit.target === "local") return "local";
  if (edit.target === "member") return "member";
  return null;
}

function isThisMemberReference(node: napi.SgNode): boolean {
  if (node.kind() !== "property_identifier") return false;
  const parent = node.parent();
  if (!parent || parent.kind() !== "member_expression") return false;
  const objectNode = parent.child(0);
  return objectNode?.kind() === "this" || objectNode?.kind() === "super";
}

function isLocalRenameTarget(node: napi.SgNode): boolean {
  if (node.kind() === "identifier") return true;
  if (node.kind() === "shorthand_property_identifier") return true;
  if (node.kind() === "shorthand_property_identifier_pattern") return true;
  return false;
}

function isMemberRenameTarget(node: napi.SgNode): boolean {
  const declarationKind = classifyRenameDeclaration(node);
  if (declarationKind === "member") return true;
  return isThisMemberReference(node);
}

function renameReplacement(node: napi.SgNode, from: string, to: string): string {
  if (node.kind() === "shorthand_property_identifier" || node.kind() === "shorthand_property_identifier_pattern") {
    return `${from}: ${to}`;
  }
  return to;
}

export type EditCodeResult = {
  path: string;
  edits: number;
  matches: number;
  diff: string;
  output: string;
  affectedSymbols: string[];
};

export type ScanCodeMatch = {
  path: string;
  line: number;
  text: string;
  captures: Record<string, string>;
  enclosingSymbol?: string;
};

export type ScanCodePatternResult = {
  pattern: string;
  matches: ScanCodeMatch[];
};

export type ScanCodeResult = {
  scanned: number;
  matches: number;
  patterns: ScanCodePatternResult[];
};

async function collectParseableFiles(dirPath: string, maxFiles = 500): Promise<string[]> {
  const files: string[] = [];
  const stack = [dirPath];
  while (stack.length > 0 && files.length < maxFiles) {
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
      if (entry.isFile() && isParseable(abs)) files.push(abs);
      if (files.length >= maxFiles) break;
    }
  }
  return files;
}

type EditCodeFileResult = {
  matches: number;
  affectedSymbols: string[];
  diff: string;
} | null;

async function editCodeFile(
  absPath: string,
  workspace: string,
  edits: EditCodeEdit[],
  throwOnNoMatch: boolean,
): Promise<EditCodeFileResult> {
  const langName = languageFromPath(absPath);
  if (!langName) return null;
  const langEnum = napi.Lang[langName as keyof typeof napi.Lang];
  const original = await readFile(absPath, "utf8");
  let current = original;
  let totalMatches = 0;
  const affectedSymbols = new Set<string>();

  for (const edit of edits) {
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
      if (throwOnNoMatch) {
        throw createToolError(
          TOOL_ERROR_CODES.editCodeNoMatch,
          `No AST matches found for ${isRenameEdit(edit) ? "rename target" : "rule"}: ${pattern}${edit.within ? ` within: ${edit.within}` : ""}${edit.withinSymbol ? ` withinSymbol: ${edit.withinSymbol}` : ""}`,
          undefined,
          editCodeRecovery(absPath, "refine-pattern"),
        );
      }
      continue;
    }
    if (isRenameEdit(edit) && !edit.target && hasRenameModeConflict(matches)) {
      if (throwOnNoMatch) {
        throw createToolError(
          TOOL_ERROR_CODES.editCodeNoMatch,
          `Scoped rename target is ambiguous for ${edit.from}; retry with target: "local" or target: "member"${edit.withinSymbol ? ` withinSymbol: ${edit.withinSymbol}` : ""}`,
          undefined,
          editCodeRecovery(absPath, "clarify-rename-target"),
        );
      }
      continue;
    }
    const renameMode = isRenameEdit(edit) ? (requestedRenameMode(edit) ?? resolveRenameMode(matches)) : null;
    if (renameMode === "local") matches = matches.filter(isLocalRenameTarget);
    if (renameMode === "member") matches = matches.filter(isMemberRenameTarget);
    if (matches.length === 0) {
      if (throwOnNoMatch) {
        throw createToolError(
          TOOL_ERROR_CODES.editCodeNoMatch,
          `No AST matches found for ${isRenameEdit(edit) ? "rename target" : "rule"}: ${pattern}${edit.within ? ` within: ${edit.within}` : ""}${edit.withinSymbol ? ` withinSymbol: ${edit.withinSymbol}` : ""}${isRenameEdit(edit) && edit.target ? ` target: ${edit.target}` : ""}`,
          undefined,
          editCodeRecovery(absPath, "refine-pattern"),
        );
      }
      continue;
    }
    totalMatches += matches.length;
    for (const match of matches) {
      const sym = findEnclosingSymbol(match);
      if (sym) affectedSymbols.add(sym);
    }

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
          editCodeRecovery(absPath, "fix-replacement"),
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
      replacements.push({
        start: range.start.index,
        end: range.end.index,
        replacement: isRenameEdit(edit) ? renameReplacement(match, edit.from, edit.to) : replaced,
      });
    }

    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      current = current.slice(0, r.start) + r.replacement + current.slice(r.end);
    }
  }

  if (totalMatches === 0) return null;

  await writeFile(absPath, current, "utf8");
  const diff = createDiff(displayPathForDiff(absPath, workspace), original, current);
  return { matches: totalMatches, affectedSymbols: Array.from(affectedSymbols), diff };
}

export async function editCode(input: {
  workspace: string;
  path: string;
  edits: EditCodeEdit[];
}): Promise<EditCodeResult> {
  const absPath = ensurePathWithinAllowedRoots(input.path, input.workspace);
  const pathStats = await stat(absPath);

  if (pathStats.isDirectory()) {
    return editCodeDirectory(input.workspace, absPath, input.edits);
  }

  if (!pathStats.isFile()) throw new Error(`code-edit requires a file or directory path, got: ${input.path}`);
  if (!isParseable(absPath)) {
    throw createToolError(
      TOOL_ERROR_CODES.editCodeUnsupportedFile,
      `code-edit requires a supported code file, got: ${input.path}`,
      undefined,
      editCodeRecovery(input.path, "use-supported-file"),
    );
  }

  await ensureDynamicLanguages();
  const result = await editCodeFile(absPath, input.workspace, input.edits, true);
  if (!result) {
    throw createToolError(
      TOOL_ERROR_CODES.editCodeNoMatch,
      `No AST matches found in ${input.path}`,
      undefined,
      editCodeRecovery(input.path, "refine-pattern"),
    );
  }

  const outputParts = [`path=${absPath}`, `edits=${input.edits.length}`, `matches=${result.matches}`];
  if (result.affectedSymbols.length > 0) outputParts.push(`symbols=${result.affectedSymbols.join(", ")}`);
  outputParts.push("", result.diff);
  return {
    path: absPath,
    edits: input.edits.length,
    matches: result.matches,
    diff: result.diff,
    output: outputParts.join("\n"),
    affectedSymbols: result.affectedSymbols,
  };
}

async function editCodeDirectory(workspace: string, dirPath: string, edits: EditCodeEdit[]): Promise<EditCodeResult> {
  await ensureDynamicLanguages();
  const files = await collectParseableFiles(dirPath);
  const diffs: string[] = [];
  let totalMatches = 0;
  const allAffectedSymbols: string[] = [];

  for (const absFile of files) {
    const result = await editCodeFile(absFile, workspace, edits, false);
    if (!result) continue;
    totalMatches += result.matches;
    allAffectedSymbols.push(...result.affectedSymbols);
    diffs.push(result.diff);
  }

  if (totalMatches === 0) {
    throw createToolError(
      TOOL_ERROR_CODES.editCodeNoMatch,
      `No AST matches found in directory: ${dirPath}`,
      undefined,
      editCodeRecovery(dirPath, "refine-pattern"),
    );
  }

  const diff = diffs.join("\n");
  const affectedSymbols = Array.from(new Set(allAffectedSymbols));
  const output = [`path=${dirPath}`, `edits=${edits.length}`, `matches=${totalMatches}`, "", diff].join("\n");
  return { path: dirPath, edits: edits.length, matches: totalMatches, diff, output, affectedSymbols };
}

export async function scanCode(input: {
  workspace: string;
  paths: string[];
  pattern: string | string[];
  language?: string;
  maxResults?: number;
}): Promise<ScanCodeResult> {
  const maxResults = input.maxResults ?? 50;
  const patterns = Array.isArray(input.pattern) ? input.pattern : [input.pattern];

  await ensureDynamicLanguages();

  const results: ScanCodePatternResult[] = patterns.map((pattern) => ({ pattern, matches: [] }));

  const totalMatches = () => results.reduce((sum, result) => sum + result.matches.length, 0);

  const scanFile = (path: string, content: string, lang: string): void => {
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
        const enclosingSymbol = findEnclosingSymbol(match) ?? undefined;
        result.matches.push({ path, line: range.start.line + 1, text, captures, enclosingSymbol });
      }
    }
  };

  let scanned = 0;

  const scanPath = async (rawPath: string) => {
    const absPath = ensurePathWithinAllowedRoots(rawPath, input.workspace);
    const info = await stat(absPath);

    if (info.isFile()) {
      if (!input.language && !isParseable(absPath)) {
        throw createToolError(
          TOOL_ERROR_CODES.scanCodeUnsupportedFile,
          `code-scan requires a supported code file, got: ${rawPath}`,
          undefined,
          scanCodeRecovery(rawPath),
        );
      }
      const content = await readFile(absPath, "utf8");
      const lang = input.language ?? languageFromPath(absPath);
      invariant(lang, `code-scan requires a supported code file, got: ${rawPath}`);
      scanned++;
      scanFile(displayPathForDiff(absPath, input.workspace), content, lang);
      return;
    }

    if (!info.isDirectory()) {
      throw new Error(`Path is not a file or directory: ${absPath}`);
    }

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
  return {
    scanned,
    matches: total,
    patterns: results,
  };
}
