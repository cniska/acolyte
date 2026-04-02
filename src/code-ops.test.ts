import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { editCode, scanCode } from "./code-ops";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { testUuid } from "./test-utils";

const WORKSPACE = resolve(process.cwd());
const tempFiles: string[] = [];
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempFiles.map(async (filePath) => rm(filePath, { force: true })));
  await Promise.all(tempDirs.map(async (dirPath) => rm(dirPath, { recursive: true, force: true })));
});

describe("editCode", () => {
  test("blocks paths outside workspace", async () => {
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: "/etc/hosts",
        edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("replaces pattern matches with metavariable capture", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, 'console.log("hello");\nconsole.log("world");\n', "utf8");
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("hello")');
    expect(content).not.toContain("console.log");
  });

  test("scopes replacements with within", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-within-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "function first() {",
        "  const result = 1;",
        "  return result;",
        "}",
        "",
        "function second() {",
        "  const result = 2;",
        "  return result;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          op: "replace",
          rule: "result",
          replacement: "value",
          within: "function second() { $$$BODY }",
        },
      ],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const result = 1;");
    expect(content).toContain("return result;");
    expect(content).toContain("const value = 2;");
    expect(content).toContain("return value;");
  });

  test("scopes replacements with withinSymbol", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-within-symbol-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "const scanFile = (items: string[]): string[] => {",
        "  const output: string[] = [];",
        "  for (const result of items) {",
        "    output.push(result.toUpperCase());",
        "  }",
        "  return output;",
        "};",
        "",
        "const totalMatches = (results: string[]) => results.reduce((sum, result) => sum + result.length, 0);",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          op: "replace",
          rule: "result",
          replacement: "patternResult",
          withinSymbol: "scanFile",
        },
      ],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("for (const patternResult of items)");
    expect(content).toContain("output.push(patternResult.toUpperCase());");
    expect(content).toContain("results.reduce((sum, result) => sum + result.length, 0);");
  });

  test("supports structured rename edits with withinSymbol", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-rename-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "const scanFile = (items: string[]): string[] => {",
        "  const output: string[] = [];",
        "  for (const result of items) {",
        "    output.push(result.toUpperCase());",
        "  }",
        "  return output;",
        "};",
        "",
        "const totalMatches = (results: string[]) => results.reduce((sum, result) => sum + result.length, 0);",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          op: "rename",
          from: "result",
          to: "patternResult",
          withinSymbol: "scanFile",
        },
      ],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("for (const patternResult of items)");
    expect(content).toContain("output.push(patternResult.toUpperCase());");
    expect(content).toContain("results.reduce((sum, result) => sum + result.length, 0);");
  });

  test("scoped local rename handles arrow function parameters", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-arrow-param-rename-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "class Processor {",
        "  process(items: string[]) {",
        "    return items.map((item) => item.toUpperCase());",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "rename", from: "item", to: "entry", withinSymbol: "Processor" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("(entry) => entry.toUpperCase()");
  });

  test("scoped local rename rewrites shorthand references without renaming object properties", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-local-rename-scope-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "const scanFile = (items: string[]) => {",
        "  const result = items[0] ?? '';",
        "  const { result: alias, other = result } = source;",
        "  return { result, nested: { result }, value: result, other: config.result, alias, other };",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile" }],
    });
    expect(result.matches).toBe(5);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const patternResult = items[0] ?? '';");
    expect(content).toContain("const { result: alias, other = patternResult } = source;");
    expect(content).toContain(
      "return { result: patternResult, nested: { result: patternResult }, value: patternResult, other: config.result, alias, other };",
    );
    expect(content).not.toContain("config.patternResult");
  });

  test("supports structured rename edits within a class declaration", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-class-rename-${testUuid()}.js`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "class ProviderConfig {",
        '  alias = "acolyte-mini";',
        "  label() {",
        "    return this.alias + config.alias;",
        "  }",
        "}",
        "",
        'const alias = "outside";',
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          op: "rename",
          from: "alias",
          to: "defaultAlias",
          withinSymbol: "ProviderConfig",
        },
      ],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('defaultAlias = "acolyte-mini";');
    expect(content).toContain("return this.defaultAlias + config.alias;");
    expect(content).toContain('const alias = "outside";');
  });

  test("scoped member rename updates declared methods and this-method calls only", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-class-method-rename-${testUuid()}.js`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "class ProviderConfig {",
        "  label() {",
        "    return this.labelText + config.label;",
        "  }",
        "  render() {",
        "    return this.label();",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "rename", from: "label", to: "displayLabel", withinSymbol: "ProviderConfig" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("displayLabel() {");
    expect(content).toContain("return this.labelText + config.label;");
    expect(content).toContain("return this.displayLabel();");
    expect(content).not.toContain("config.displayLabel");
  });

  test("ambiguous scoped rename can target the member explicitly", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-ambiguous-member-rename-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "class ProviderConfig {",
        '  alias = "x";',
        "  method() {",
        "    const alias = this.alias;",
        "    return { alias, member: this.alias, other: config.alias };",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "rename", from: "alias", to: "defaultAlias", withinSymbol: "ProviderConfig", target: "member" }],
    });
    expect(result.matches).toBe(3);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('defaultAlias = "x";');
    expect(content).toContain("const alias = this.defaultAlias;");
    expect(content).toContain("return { alias, member: this.defaultAlias, other: config.alias };");
    expect(content).not.toContain("const defaultAlias = this.defaultAlias;");
  });

  test("ambiguous scoped rename can target the local symbol explicitly", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-ambiguous-local-rename-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "class ProviderConfig {",
        '  alias = "x";',
        "  method() {",
        "    const alias = this.alias;",
        "    return { alias, member: this.alias, other: config.alias };",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "rename", from: "alias", to: "localAlias", withinSymbol: "ProviderConfig", target: "local" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const localAlias = this.alias;");
    expect(content).toContain("return { alias: localAlias, member: this.alias, other: config.alias };");
    expect(content).toContain('  alias = "x";');
  });

  test("ambiguous scoped rename fails with recovery when target is omitted", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-ambiguous-rename-auto-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "class ProviderConfig {",
        '  alias = "x";',
        "  method() {",
        "    const alias = this.alias;",
        "    return { alias, member: this.alias, other: config.alias };",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ op: "rename", from: "alias", to: "defaultAlias", withinSymbol: "ProviderConfig" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeNoMatch,
      message: expect.stringContaining('target: "local" or target: "member"'),
    });
  });

  test("scoped rename fails when explicit target has no matches in scope", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-invalid-target-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "const scanFile = (items: string[]) => {",
        "  const result = items[0] ?? '';",
        "  return { result };",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile", target: "member" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeNoMatch,
      message: expect.stringContaining("target: member"),
    });
  });

  test("scoped local rename rewrites shorthand destructuring bindings", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-local-rename-destructure-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      ["const scanFile = ({ result }: { result: string }) => {", "  return result.toUpperCase();", "};", ""].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const scanFile = ({ result: patternResult }: { result: string }) => {");
    expect(content).toContain("return patternResult.toUpperCase();");
  });

  test("rename matches exact identifiers only", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-rename-exact-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "const scanFile = (items: string[]): string[] => {",
        "  const result = items[0] ?? '';",
        "  const resultCount = items.length;",
        "  return [result, String(resultCount)];",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const patternResult = items[0] ?? '';");
    expect(content).toContain("return [patternResult, String(resultCount)];");
    expect(content).toContain("const resultCount = items.length;");
  });

  test("supports structured replace patterns with context and selector", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-pattern-object-${testUuid()}.js`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "class ProviderConfig {",
        '  alias = "acolyte-mini";',
        '  mode = "default";',
        "}",
        "",
        'const alias = "outside";',
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          op: "replace",
          rule: {
            context: "class ProviderConfig { alias = $VALUE }",
            selector: "field_definition",
          },
          replacement: "defaultAlias = $VALUE",
        },
      ],
    });
    expect(result.matches).toBe(1);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('defaultAlias = "acolyte-mini";');
    expect(content).toContain('const alias = "outside";');
    expect(content).not.toContain('alias = "acolyte-mini";');
  });

  test("supports recursive rule objects for replacements", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-rule-object-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      ['console.log("first");', 'console.info("second");', 'console.warn("third");', ""].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          op: "replace",
          rule: {
            any: ["console.log($ARG)", "console.info($ARG)"],
          },
          replacement: "logger.debug($ARG)",
        },
      ],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("first");');
    expect(content).toContain('logger.debug("second");');
    expect(content).toContain('console.warn("third");');
  });

  test("supports nested all/any/inside rule combinations", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-nested-rules-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "function logMessages() {",
        '  console.log("first");',
        '  console.info("second");',
        "}",
        "",
        "function keepMessages() {",
        '  console.log("outside");',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          op: "replace",
          rule: {
            all: [
              { any: ["console.log($ARG)", "console.info($ARG)"] },
              {
                inside: {
                  pattern: {
                    context: "function logMessages() { $$$BODY }",
                    selector: "function_declaration",
                  },
                  stopBy: "end",
                },
              },
            ],
          },
          replacement: "logger.debug($ARG)",
        },
      ],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("first");');
    expect(content).toContain('logger.debug("second");');
    expect(content).toContain('console.log("outside");');
  });

  test("supports relational stopBy rule objects", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-stop-by-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      [
        "function outer() {",
        "  function inner() {",
        '    console.log("inner");',
        "  }",
        '  console.log("outer");',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          op: "replace",
          rule: {
            pattern: "console.log($ARG)",
            inside: {
              kind: "function_declaration",
              stopBy: {
                kind: "function_declaration",
                pattern: {
                  context: "function outer() { $$$BODY }",
                  selector: "function_declaration",
                },
              },
            },
          },
          replacement: "logger.debug($ARG)",
        },
      ],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("inner");');
    expect(content).toContain('logger.debug("outer");');
  });

  test("throws when no matches found", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-nomatch-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeNoMatch,
    });
  });

  test("formats no-match errors with readable rule summaries", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-readable-error-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: filePath,
        edits: [
          {
            op: "replace",
            rule: { any: ["console.log($ARG)", "console.info($ARG)"] },
            replacement: "logger.debug($ARG)",
          },
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("No AST matches found for rule: any(2)"),
    });
  });

  test("applies edits across directory", async () => {
    const dirPath = join(WORKSPACE, `acolyte-test-ast-dir-${testUuid()}`);
    tempDirs.push(dirPath);
    await mkdir(dirPath, { recursive: true });
    await writeFile(join(dirPath, "a.ts"), "const x = oldName();\n", "utf8");
    await writeFile(join(dirPath, "b.ts"), "const y = oldName();\n", "utf8");
    tempFiles.push(join(dirPath, "a.ts"), join(dirPath, "b.ts"));
    const result = await editCode({
      workspace: dirPath,
      path: dirPath,
      edits: [{ op: "rename", from: "oldName", to: "newName" }],
    });
    expect(result.matches).toBe(2);
    expect(result.diff).toContain("a.ts");
    expect(result.diff).toContain("b.ts");
    const aContent = await readFile(join(dirPath, "a.ts"), "utf8");
    const bContent = await readFile(join(dirPath, "b.ts"), "utf8");
    expect(aContent).toContain("newName");
    expect(bContent).toContain("newName");
  });

  test("workspace scope renames across all project files", async () => {
    const dirPath = join(WORKSPACE, `acolyte-test-ast-ws-${testUuid()}`);
    tempDirs.push(dirPath);
    await mkdir(dirPath, { recursive: true });
    await writeFile(join(dirPath, "lib.ts"), "export function oldName() { return 1; }\n", "utf8");
    await writeFile(join(dirPath, "main.ts"), "import { oldName } from './lib';\noldName();\n", "utf8");
    tempFiles.push(join(dirPath, "lib.ts"), join(dirPath, "main.ts"));
    const result = await editCode({
      workspace: dirPath,
      path: join(dirPath, "lib.ts"),
      edits: [{ op: "rename", from: "oldName", to: "newName", scope: "workspace" }],
    });
    expect(result.matches).toBeGreaterThanOrEqual(3);
    const libContent = await readFile(join(dirPath, "lib.ts"), "utf8");
    const mainContent = await readFile(join(dirPath, "main.ts"), "utf8");
    expect(libContent).toContain("newName");
    expect(mainContent).toContain("newName");
    expect(mainContent).not.toContain("oldName");
  });

  test("rejects unsupported non-code files", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-md-${testUuid()}.md`);
    tempFiles.push(filePath);
    await writeFile(filePath, "# Title\n", "utf8");
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ op: "replace", rule: "Title", replacement: "Heading" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeUnsupportedFile,
    });
  });

  test("rejects unknown single-file extensions without falling back", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-yaml-${testUuid()}.yaml`);
    tempFiles.push(filePath);
    await writeFile(filePath, "foo: bar\n", "utf8");
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ op: "replace", rule: "foo: $VALUE", replacement: "bar: $VALUE" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeUnsupportedFile,
    });
  });

  test("rejects replacement metavariables that are not present in the pattern", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-missing-meta-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, 'console.log("hello");\n', "utf8");
    await expect(
      editCode({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($MISSING)" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeReplacementMetaMismatch,
    });
  });

  test("supports variadic metavariables in replacements", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-variadic-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, "sum(a, b);\nsum(c);\n", "utf8");
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "replace", rule: "sum($$$ARGS)", replacement: "total($$$ARGS)" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("total(a, b);");
    expect(content).toContain("total(c);");
    expect(content).not.toContain("sum(");
  });

  test("replaces in Python files", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-py-${testUuid()}.py`);
    tempFiles.push(filePath);
    await writeFile(filePath, 'print("hello")\nprint("world")\n', "utf8");
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "replace", rule: "print($ARG)", replacement: "log($ARG)" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('log("hello")');
    expect(content).not.toContain("print");
  });

  test("replaces in Rust files", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-rs-${testUuid()}.rs`);
    tempFiles.push(filePath);
    await writeFile(filePath, 'println!("hello");\nprintln!("world");\n', "utf8");
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "replace", rule: "println!($ARGS)", replacement: "eprintln!($ARGS)" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("eprintln!");
    expect(content).not.toMatch(/(?<!e)println!/);
  });

  test("replaces in Go files", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-go-${testUuid()}.go`);
    tempFiles.push(filePath);
    await writeFile(filePath, 'package main\n\nfunc main() {\n\tprintln("hello")\n\tprintln("world")\n}\n', "utf8");
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ op: "replace", rule: "println($ARG)", replacement: "print($ARG)" }],
    });
    expect(result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("print(");
    expect(content).not.toContain("println(");
  });

  test("includes affectedSymbols in result", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-ast-affected-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      ['function processItems() { console.log("processing"); }', 'function other() { console.log("other"); }', ""].join(
        "\n",
      ),
      "utf8",
    );
    const result = await editCode({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        { op: "replace", rule: "console.log($ARG)", replacement: "logger.info($ARG)", withinSymbol: "processItems" },
      ],
    });
    expect(result.affectedSymbols).toEqual(["processItems"]);
  });
});

describe("scanCode", () => {
  test("blocks paths outside workspace", async () => {
    await expect(scanCode({ workspace: WORKSPACE, paths: ["/etc/hosts"], pattern: "const $X" })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("rejects unsupported single-file types", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-unsupported-${testUuid()}.yaml`);
    tempFiles.push(filePath);
    await writeFile(filePath, "foo: bar\n", "utf8");
    await expect(scanCode({ workspace: WORKSPACE, paths: [filePath], pattern: "const $X" })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.scanCodeUnsupportedFile,
    });
  });

  test("finds matches with metavariable captures", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, 'console.log("hello");\nconsole.log("world");\nconst x = 1;\n', "utf8");
    const result = await scanCode({ workspace: WORKSPACE, paths: [filePath], pattern: "console.log($ARG)" });
    expect(result.scanned).toBe(1);
    expect(result.matches).toBe(2);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]?.matches[0]?.captures.$ARG).toBe('"hello"');
  });

  test("returns no matches when pattern is absent", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-nomatch-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    const result = await scanCode({ workspace: WORKSPACE, paths: [filePath], pattern: "console.log($ARG)" });
    expect(result.scanned).toBe(1);
    expect(result.matches).toBe(0);
    expect(result.patterns[0]?.matches).toEqual([]);
  });

  test("scans a directory recursively", async () => {
    const dirPath = join(WORKSPACE, `acolyte-test-scan-dir-${testUuid()}`);
    tempDirs.push(dirPath);
    await mkdir(join(dirPath, "sub"), { recursive: true });
    await writeFile(join(dirPath, "a.ts"), 'console.log("a");\n', "utf8");
    await writeFile(join(dirPath, "sub", "b.ts"), 'console.log("b");\nconst y = 2;\n', "utf8");
    const result = await scanCode({ workspace: WORKSPACE, paths: [dirPath], pattern: "console.log($ARG)" });
    expect(result.scanned).toBe(2);
    expect(result.matches).toBe(2);
  });

  test("respects maxResults limit", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-limit-${testUuid()}.ts`);
    tempFiles.push(filePath);
    const lines = `${Array.from({ length: 10 }, (_, i) => `console.log("line${i}");`).join("\n")}\n`;
    await writeFile(filePath, lines, "utf8");
    const result = await scanCode({
      workspace: WORKSPACE,
      paths: [filePath],
      pattern: "console.log($ARG)",
      maxResults: 3,
    });
    expect(result.matches).toBe(3);
  });

  test("batches multiple patterns", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-batch-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, 'export function hello() {}\nexport const x = 1;\nconsole.log("test");\n', "utf8");
    const result = await scanCode({
      workspace: WORKSPACE,
      paths: [filePath],
      pattern: ["export function $NAME() {}", "console.log($ARG)"],
    });
    expect(result.matches).toBe(2);
    expect(result.patterns).toHaveLength(2);
    expect(result.patterns[0]?.matches[0]?.captures.$NAME).toBe("hello");
    expect(result.patterns[1]?.matches[0]?.captures.$ARG).toBe('"test"');
  });

  test("includes enclosingSymbol for match inside a function", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-enclosing-fn-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      ["function processItems() {", "  console.log('processing');", "}", ""].join("\n"),
      "utf8",
    );
    const result = await scanCode({ workspace: WORKSPACE, paths: [filePath], pattern: "console.log($ARG)" });
    expect(result.patterns[0]?.matches[0]?.enclosingSymbol).toBe("processItems");
  });

  test("includes enclosingSymbol for match inside a class", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-enclosing-class-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(
      filePath,
      ["class MyService {", "  run() {", "    console.log('run');", "  }", "}", ""].join("\n"),
      "utf8",
    );
    const result = await scanCode({ workspace: WORKSPACE, paths: [filePath], pattern: "console.log($ARG)" });
    const match = result.patterns[0]?.matches[0];
    expect(match?.enclosingSymbol).toBe("run");
  });

  test("enclosingSymbol is undefined at top-level", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-enclosing-top-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, "console.log('top-level');\n", "utf8");
    const result = await scanCode({ workspace: WORKSPACE, paths: [filePath], pattern: "console.log($ARG)" });
    expect(result.patterns[0]?.matches[0]?.enclosingSymbol).toBeUndefined();
  });

  test("includes enclosingSymbol for match inside a TypeScript type alias", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-scan-enclosing-type-${testUuid()}.ts`);
    tempFiles.push(filePath);
    await writeFile(filePath, 'type Status = "active" | "inactive";\n', "utf8");
    const result = await scanCode({ workspace: WORKSPACE, paths: [filePath], pattern: '"active"' });
    expect(result.patterns[0]?.matches[0]?.enclosingSymbol).toBe("Status");
  });
});
