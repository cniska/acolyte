import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import * as ts from "typescript";

type Edit = { start: number; end: number; text: string };

const ROOTS = ["src", "scripts"];
const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".mastra", "dist", "build", "coverage"]);
const SUPPORTED_EXT = new Set([".ts", ".tsx"]);
const ALLOWED_STATEMENTS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ContinueStatement,
]);

async function collectFiles(dir: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...(await collectFiles(join(dir, entry.name))));
      continue;
    }
    if (!entry.isFile()) continue;
    const fullPath = join(dir, entry.name);
    if (SUPPORTED_EXT.has(extname(fullPath))) out.push(fullPath);
  }
  return out;
}

function isSafeCommentFreeBlock(sourceText: string, block: ts.Block): boolean {
  const blockText = sourceText.slice(block.getStart(), block.end);
  return !blockText.includes("//") && !blockText.includes("/*");
}

function hasNewline(text: string): boolean {
  return text.includes("\n") || text.includes("\r");
}

function isElseIfNode(node: ts.IfStatement): boolean {
  return ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
}

function findEdits(filePath: string, sourceText: string): Edit[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const edits: Edit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      if (!isElseIfNode(node) && !node.elseStatement && ts.isBlock(node.thenStatement)) {
        const block = node.thenStatement;
        if (block.statements.length === 1) {
          const statement = block.statements[0];
          if (ALLOWED_STATEMENTS.has(statement.kind) && isSafeCommentFreeBlock(sourceText, block)) {
            const conditionText = sourceText.slice(node.expression.getStart(sourceFile), node.expression.end).trim();
            const statementText = sourceText.slice(statement.getStart(sourceFile), statement.end).trim();
            if (!hasNewline(conditionText) && !hasNewline(statementText)) {
              edits.push({
                start: node.getStart(sourceFile),
                end: block.end,
                text: `if (${conditionText}) ${statementText}`,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return edits;
}

function applyEdits(sourceText: string, edits: Edit[]): string {
  if (edits.length === 0) return sourceText;
  let next = sourceText;
  const ordered = edits.slice().sort((a, b) => b.start - a.start);
  for (const edit of ordered) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  return next;
}

async function run(): Promise<void> {
  const files = (await Promise.all(ROOTS.map((root) => collectFiles(root)))).flat();
  let changedFiles = 0;
  let changedIfs = 0;

  for (const filePath of files) {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) continue;
    const sourceText = await readFile(filePath, "utf8");
    const edits = findEdits(filePath, sourceText);
    if (edits.length === 0) continue;
    const next = applyEdits(sourceText, edits);
    if (next === sourceText) continue;
    await writeFile(filePath, next, "utf8");
    changedFiles += 1;
    changedIfs += edits.length;
  }

  console.log(`codemod-single-line-if: files=${changedFiles} ifs=${changedIfs}`);
}

await run();
