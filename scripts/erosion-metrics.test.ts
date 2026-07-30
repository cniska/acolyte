import { describe, expect, test } from "bun:test";
import { analyzeSource, computeErosion, HIGH_COMPLEXITY_THRESHOLD } from "./erosion-metrics";

function complexityOf(source: string, name: string): number {
  const metric = analyzeSource("sample.ts", source).find((entry) => entry.name === name);
  if (!metric) throw new Error(`no metric for ${name}`);
  return metric.cyclomatic;
}

describe("analyzeSource complexity", () => {
  test("a straight-line function scores 1", () => {
    expect(complexityOf("function f() {\n  return 1;\n}\n", "f")).toBe(1);
  });

  test("branches, loops, and catch each add one", () => {
    const source = [
      "function f(items: number[]) {",
      "  let total = 0;",
      "  if (items.length === 0) return 0;",
      "  for (const item of items) {",
      "    while (total < item) total += 1;",
      "  }",
      "  try {",
      "    total += 1;",
      "  } catch {",
      "    total = 0;",
      "  }",
      "  return total;",
      "}",
    ].join("\n");
    expect(complexityOf(source, "f")).toBe(5);
  });

  test("logical operators and ternaries count as decisions", () => {
    const source = "function f(a: boolean, b: boolean, c: number | null) {\n  return a && b ? (c ?? 0) : 1;\n}\n";
    expect(complexityOf(source, "f")).toBe(4);
  });

  test("case clauses count but an empty fallthrough and default do not", () => {
    const source = [
      "function f(kind: string) {",
      "  switch (kind) {",
      "    case 'a':",
      "    case 'b':",
      "      return 1;",
      "    default:",
      "      return 0;",
      "  }",
      "}",
    ].join("\n");
    expect(complexityOf(source, "f")).toBe(2);
  });
});

describe("analyzeSource units", () => {
  test("an inline callback folds into its enclosing function", () => {
    const source = [
      "function f(items: number[]) {",
      "  return items.filter((item) => item > 0 && item < 10);",
      "}",
    ].join("\n");
    const metrics = analyzeSource("sample.ts", source);
    expect(metrics.map((metric) => metric.name)).toEqual(["f"]);
    expect(metrics[0].cyclomatic).toBe(2);
  });

  test("an arrow bound to a name is its own unit", () => {
    const source = "const f = (a: boolean) => (a ? 1 : 0);\n";
    const metrics = analyzeSource("sample.ts", source);
    expect(metrics.map((metric) => metric.name)).toEqual(["f"]);
    expect(metrics[0].cyclomatic).toBe(2);
  });

  test("a nested named function is measured separately from its parent", () => {
    const source = [
      "function outer(a: boolean) {",
      "  function inner(b: boolean) {",
      "    return b ? 1 : 0;",
      "  }",
      "  return a ? inner(a) : 0;",
      "}",
    ].join("\n");
    const metrics = analyzeSource("sample.ts", source);
    expect(metrics.map((metric) => metric.name).sort()).toEqual(["inner", "outer"]);
    expect(complexityOf(source, "outer")).toBe(2);
    expect(complexityOf(source, "inner")).toBe(2);
  });

  test("methods and accessors are named after their class", () => {
    const source = [
      "class Store {",
      "  constructor() {}",
      "  get size() {",
      "    return 0;",
      "  }",
      "  read(key: string) {",
      "    return key;",
      "  }",
      "}",
    ].join("\n");
    const names = analyzeSource("sample.ts", source).map((metric) => metric.name);
    expect(names).toEqual(["Store.constructor", "Store.size", "Store.read"]);
  });
});

describe("analyzeSource sloc", () => {
  test("blank lines, comments, and nested unit bodies are excluded", () => {
    const source = [
      "function outer() {",
      "  // a comment",
      "",
      "  const inner = () => {",
      "    return 1;",
      "  };",
      "  return inner();",
      "}",
    ].join("\n");
    const outer = analyzeSource("sample.ts", source).find((metric) => metric.name === "outer");
    expect(outer?.sloc).toBe(4);
  });

  test("mass weights complexity by the square root of sloc", () => {
    const metrics = analyzeSource("sample.ts", "function f() {\n  return 1;\n}\n");
    expect(metrics[0].mass).toBeCloseTo(Math.sqrt(3), 10);
  });
});

describe("computeErosion", () => {
  test("erosion is the share of mass held by high-complexity functions", () => {
    const metrics = [
      { file: "a.ts", name: "light", line: 1, cyclomatic: 2, sloc: 4, mass: 4 },
      { file: "a.ts", name: "heavy", line: 9, cyclomatic: HIGH_COMPLEXITY_THRESHOLD + 1, sloc: 36, mass: 12 },
    ];
    const report = computeErosion(metrics, 1);
    expect(report.erosion).toBeCloseTo(0.75, 10);
    expect(report.highFunctions).toBe(1);
    expect(report.functions).toBe(2);
    expect(report.sloc).toBe(40);
  });

  test("an empty codebase reports zero erosion rather than dividing by zero", () => {
    expect(computeErosion([], 0).erosion).toBe(0);
  });
});
