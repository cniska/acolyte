import ts from "typescript";

export const HIGH_COMPLEXITY_THRESHOLD = 10;

export type FunctionMetric = {
  file: string;
  name: string;
  line: number;
  cyclomatic: number;
  sloc: number;
  mass: number;
};

export type ErosionReport = {
  erosion: number;
  files: number;
  functions: number;
  highFunctions: number;
  totalMass: number;
  highMass: number;
  sloc: number;
};

const DECISION_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isDecision(node: ts.Node): boolean {
  if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) return true;
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) return true;
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) return true;
  if (ts.isCatchClause(node)) return true;
  if (ts.isCaseClause(node)) return node.statements.length > 0;
  if (ts.isBinaryExpression(node)) return DECISION_OPERATORS.has(node.operatorToken.kind);
  return false;
}

// A unit is what a reader calls "a function". Inline callbacks are folded into their
// enclosing unit so that `.map(x => x + 1)` does not dilute the mass denominator.
function isUnit(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) return true;
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return true;
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const parent = node.parent;
    return ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent);
  }
  return false;
}

function ownerName(node: ts.Node): string | null {
  const parent = node.parent;
  if (parent && ts.isClassDeclaration(parent) && parent.name) return parent.name.text;
  if (parent && ts.isClassExpression(parent) && parent.name) return parent.name.text;
  return null;
}

function unitName(node: ts.Node): string {
  if (ts.isConstructorDeclaration(node)) {
    const owner = ownerName(node);
    return owner ? `${owner}.constructor` : "constructor";
  }
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? "<anonymous>";
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "<computed>";
    const owner = ownerName(node);
    return owner ? `${owner}.${name}` : name;
  }
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
    const owner = ownerName(parent);
    return owner ? `${owner}.${parent.name.text}` : parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return "<anonymous>";
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function isCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  return !(trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*"));
}

function collectUnits(source: ts.SourceFile): ts.Node[] {
  const units: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (isUnit(node)) units.push(node);
    node.forEachChild(visit);
  };
  source.forEachChild(visit);
  return units;
}

function walkOwnNodes(unit: ts.Node, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    if (node !== unit && isUnit(node)) return;
    visit(node);
    node.forEachChild(step);
  };
  step(unit);
}

function nestedUnits(unit: ts.Node): ts.Node[] {
  const nested: ts.Node[] = [];
  const step = (node: ts.Node, depth: number): void => {
    if (isUnit(node) && depth > 0) {
      nested.push(node);
      return;
    }
    node.forEachChild((child) => step(child, depth + 1));
  };
  step(unit, 0);
  return nested;
}

function ownLineNumbers(unit: ts.Node, source: ts.SourceFile): Set<number> {
  const start = source.getLineAndCharacterOfPosition(unit.getStart(source)).line;
  const end = source.getLineAndCharacterOfPosition(unit.end).line;
  const lines = new Set<number>();
  for (let line = start; line <= end; line++) lines.add(line);
  for (const nested of nestedUnits(unit)) {
    const nestedStart = source.getLineAndCharacterOfPosition(nested.getStart(source)).line;
    const nestedEnd = source.getLineAndCharacterOfPosition(nested.end).line;
    for (let line = nestedStart + 1; line <= nestedEnd; line++) lines.delete(line);
  }
  return lines;
}

export function analyzeSource(file: string, text: string): FunctionMetric[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const lines = text.split("\n");
  return collectUnits(source).map((unit) => {
    let cyclomatic = 1;
    walkOwnNodes(unit, (node) => {
      if (isDecision(node)) cyclomatic += 1;
    });
    let sloc = 0;
    for (const line of ownLineNumbers(unit, source)) {
      if (isCodeLine(lines[line] ?? "")) sloc += 1;
    }
    return {
      file,
      name: unitName(unit),
      line: source.getLineAndCharacterOfPosition(unit.getStart(source)).line + 1,
      cyclomatic,
      sloc,
      mass: cyclomatic * Math.sqrt(sloc),
    };
  });
}

export function computeErosion(metrics: FunctionMetric[], files: number): ErosionReport {
  const high = metrics.filter((metric) => metric.cyclomatic > HIGH_COMPLEXITY_THRESHOLD);
  const totalMass = metrics.reduce((sum, metric) => sum + metric.mass, 0);
  const highMass = high.reduce((sum, metric) => sum + metric.mass, 0);
  return {
    erosion: totalMass === 0 ? 0 : highMass / totalMass,
    files,
    functions: metrics.length,
    highFunctions: high.length,
    totalMass,
    highMass,
    sloc: metrics.reduce((sum, metric) => sum + metric.sloc, 0),
  };
}
