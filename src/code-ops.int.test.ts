import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { tempDir } from "./test-utils";
import { toolsForAgent } from "./tool-registry";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

describe("editCode", () => {
  test("rejects paths outside sandbox via dispatch", async () => {
    const workspace = dirs.createDir("acolyte-test-sandbox-edit-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, "const x = 1;\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editCode.execute(
        { path: "/etc/hosts", edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($ARG)" }] },
        "call_1",
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
    });
  });

  test("replaces pattern matches with metavariable capture", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, 'console.log("hello");\nconsole.log("world");\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($ARG)" }] },
      "call_2",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("hello")');
    expect(content).not.toContain("console.log");
  });

  test("scopes replacements with within", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-within-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
        path: filePath,
        edits: [
          {
            op: "replace",
            rule: "result",
            replacement: "value",
            within: "function second() { $$$BODY }",
          },
        ],
      },
      "call_3",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const result = 1;");
    expect(content).toContain("return result;");
    expect(content).toContain("const value = 2;");
    expect(content).toContain("return value;");
  });

  test("scopes replacements with withinSymbol", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-within-symbol-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
        path: filePath,
        edits: [
          {
            op: "replace",
            rule: "result",
            replacement: "patternResult",
            withinSymbol: "scanFile",
          },
        ],
      },
      "call_4",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("for (const patternResult of items)");
    expect(content).toContain("output.push(patternResult.toUpperCase());");
    expect(content).toContain("results.reduce((sum, result) => sum + result.length, 0);");
  });

  test("supports structured rename edits with withinSymbol", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-rename-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
        path: filePath,
        edits: [
          {
            op: "rename",
            from: "result",
            to: "patternResult",
            withinSymbol: "scanFile",
          },
        ],
      },
      "call_5",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("for (const patternResult of items)");
    expect(content).toContain("output.push(patternResult.toUpperCase());");
    expect(content).toContain("results.reduce((sum, result) => sum + result.length, 0);");
  });

  test("scoped local rename handles arrow function parameters", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-arrow-param-rename-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "rename", from: "item", to: "entry", withinSymbol: "Processor" }] },
      "call_6",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("(entry) => entry.toUpperCase()");
  });

  test("scoped local rename rewrites shorthand references without renaming object properties", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-local-rename-scope-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile" }] },
      "call_7",
    );
    expect(result.result.matches).toBe(5);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const patternResult = items[0] ?? '';");
    expect(content).toContain("const { result: alias, other = patternResult } = source;");
    expect(content).toContain(
      "return { result: patternResult, nested: { result: patternResult }, value: patternResult, other: config.result, alias, other };",
    );
    expect(content).not.toContain("config.patternResult");
  });

  test("supports structured rename edits within a class declaration", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-class-rename-");
    const filePath = join(workspace, "file.js");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
        path: filePath,
        edits: [
          {
            op: "rename",
            from: "alias",
            to: "defaultAlias",
            withinSymbol: "ProviderConfig",
          },
        ],
      },
      "call_8",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('defaultAlias = "acolyte-mini";');
    expect(content).toContain("return this.defaultAlias + config.alias;");
    expect(content).toContain('const alias = "outside";');
  });

  test("scoped member rename updates declared methods and this-method calls only", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-class-method-rename-");
    const filePath = join(workspace, "file.js");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "rename", from: "label", to: "displayLabel", withinSymbol: "ProviderConfig" }] },
      "call_9",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("displayLabel() {");
    expect(content).toContain("return this.labelText + config.label;");
    expect(content).toContain("return this.displayLabel();");
    expect(content).not.toContain("config.displayLabel");
  });

  test("ambiguous scoped rename can target the member explicitly", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-ambiguous-member-rename-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
        path: filePath,
        edits: [{ op: "rename", from: "alias", to: "defaultAlias", withinSymbol: "ProviderConfig", target: "member" }],
      },
      "call_10",
    );
    expect(result.result.matches).toBe(3);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('defaultAlias = "x";');
    expect(content).toContain("const alias = this.defaultAlias;");
    expect(content).toContain("return { alias, member: this.defaultAlias, other: config.alias };");
    expect(content).not.toContain("const defaultAlias = this.defaultAlias;");
  });

  test("ambiguous scoped rename can target the local symbol explicitly", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-ambiguous-local-rename-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
        path: filePath,
        edits: [{ op: "rename", from: "alias", to: "localAlias", withinSymbol: "ProviderConfig", target: "local" }],
      },
      "call_11",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const localAlias = this.alias;");
    expect(content).toContain("return { alias: localAlias, member: this.alias, other: config.alias };");
    expect(content).toContain('  alias = "x";');
  });

  test("ambiguous scoped rename fails with recovery when target is omitted", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-ambiguous-rename-auto-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editCode.execute(
        {
          path: filePath,
          edits: [{ op: "rename", from: "alias", to: "defaultAlias", withinSymbol: "ProviderConfig" }],
        },
        "call_12",
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeNoMatch,
      message: expect.stringContaining('target: "local" or target: "member"'),
    });
  });

  test("scoped rename fails when explicit target has no matches in scope", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-invalid-target-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editCode.execute(
        {
          path: filePath,
          edits: [{ op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile", target: "member" }],
        },
        "call_13",
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeNoMatch,
      message: expect.stringContaining("target: member"),
    });
  });

  test("scoped local rename rewrites shorthand destructuring bindings", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-local-rename-destructure-");
    const filePath = join(workspace, "file.ts");
    await writeFile(
      filePath,
      ["const scanFile = ({ result }: { result: string }) => {", "  return result.toUpperCase();", "};", ""].join("\n"),
      "utf8",
    );
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile" }] },
      "call_14",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const scanFile = ({ result: patternResult }: { result: string }) => {");
    expect(content).toContain("return patternResult.toUpperCase();");
  });

  test("rename matches exact identifiers only", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-rename-exact-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile" }] },
      "call_15",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("const patternResult = items[0] ?? '';");
    expect(content).toContain("return [patternResult, String(resultCount)];");
    expect(content).toContain("const resultCount = items.length;");
  });

  test("supports structured replace patterns with context and selector", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-pattern-object-");
    const filePath = join(workspace, "file.js");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
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
      },
      "call_16",
    );
    expect(result.result.matches).toBe(1);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('defaultAlias = "acolyte-mini";');
    expect(content).toContain('const alias = "outside";');
    expect(content).not.toContain('alias = "acolyte-mini";');
  });

  test("supports recursive rule objects for replacements", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-rule-object-");
    const filePath = join(workspace, "file.ts");
    await writeFile(
      filePath,
      ['console.log("first");', 'console.info("second");', 'console.warn("third");', ""].join("\n"),
      "utf8",
    );
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
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
      },
      "call_17",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("first");');
    expect(content).toContain('logger.debug("second");');
    expect(content).toContain('console.warn("third");');
  });

  test("supports nested all/any/inside rule combinations", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-nested-rules-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
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
      },
      "call_18",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("first");');
    expect(content).toContain('logger.debug("second");');
    expect(content).toContain('console.log("outside");');
  });

  test("supports relational stopBy rule objects", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-stop-by-");
    const filePath = join(workspace, "file.ts");
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
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
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
      },
      "call_19",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("inner");');
    expect(content).toContain('logger.debug("outer");');
  });

  test("throws when no matches found", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-nomatch-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, "const x = 1;\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editCode.execute(
        { path: filePath, edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($ARG)" }] },
        "call_20",
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeNoMatch,
    });
  });

  test("formats no-match errors with readable rule summaries", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-readable-error-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, "const x = 1;\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editCode.execute(
        {
          path: filePath,
          edits: [
            {
              op: "replace",
              rule: { any: ["console.log($ARG)", "console.info($ARG)"] },
              replacement: "logger.debug($ARG)",
            },
          ],
        },
        "call_21",
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("No AST matches found for rule: any(2)"),
    });
  });

  test("applies edits across directory", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-dir-");
    await writeFile(join(workspace, "a.ts"), "const x = oldName();\n", "utf8");
    await writeFile(join(workspace, "b.ts"), "const y = oldName();\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: workspace, edits: [{ op: "rename", from: "oldName", to: "newName" }] },
      "call_22",
    );
    expect(result.result.matches).toBe(2);
    expect(result.result.output).toContain("a.ts");
    expect(result.result.output).toContain("b.ts");
    const aContent = await readFile(join(workspace, "a.ts"), "utf8");
    const bContent = await readFile(join(workspace, "b.ts"), "utf8");
    expect(aContent).toContain("newName");
    expect(bContent).toContain("newName");
  });

  test("workspace scope renames across all project files", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-ws-");
    await writeFile(join(workspace, "lib.ts"), "export function oldName() { return 1; }\n", "utf8");
    await writeFile(join(workspace, "main.ts"), "import { oldName } from './lib';\noldName();\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: join(workspace, "lib.ts"), edits: [{ op: "rename", from: "oldName", to: "newName", scope: "workspace" }] },
      "call_23",
    );
    expect(result.result.matches).toBeGreaterThanOrEqual(3);
    const libContent = await readFile(join(workspace, "lib.ts"), "utf8");
    const mainContent = await readFile(join(workspace, "main.ts"), "utf8");
    expect(libContent).toContain("newName");
    expect(mainContent).toContain("newName");
    expect(mainContent).not.toContain("oldName");
  });

  test("workspace scope replaces across all project files", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-ws-replace-");
    await writeFile(join(workspace, "a.ts"), "console.log('hello');\n", "utf8");
    await writeFile(join(workspace, "b.ts"), "console.log('world');\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
        path: join(workspace, "a.ts"),
        edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.info($ARG)", scope: "workspace" }],
      },
      "call_24",
    );
    expect(result.result.matches).toBe(2);
    const aContent = await readFile(join(workspace, "a.ts"), "utf8");
    const bContent = await readFile(join(workspace, "b.ts"), "utf8");
    expect(aContent).toContain("logger.info");
    expect(bContent).toContain("logger.info");
  });

  test("rejects unsupported non-code files", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-md-");
    const filePath = join(workspace, "file.md");
    await writeFile(filePath, "# Title\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editCode.execute(
        { path: filePath, edits: [{ op: "replace", rule: "Title", replacement: "Heading" }] },
        "call_25",
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeUnsupportedFile,
    });
  });

  test("rejects unknown single-file extensions without falling back", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-yaml-");
    const filePath = join(workspace, "file.yaml");
    await writeFile(filePath, "foo: bar\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editCode.execute(
        { path: filePath, edits: [{ op: "replace", rule: "foo: $VALUE", replacement: "bar: $VALUE" }] },
        "call_26",
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeUnsupportedFile,
    });
  });

  test("rejects replacement metavariables that are not present in the pattern", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-missing-meta-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, 'console.log("hello");\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editCode.execute(
        { path: filePath, edits: [{ op: "replace", rule: "console.log($ARG)", replacement: "logger.debug($MISSING)" }] },
        "call_27",
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editCodeReplacementMetaMismatch,
    });
  });

  test("supports variadic metavariables in replacements", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-variadic-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, "sum(a, b);\nsum(c);\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "replace", rule: "sum($$$ARGS)", replacement: "total($$$ARGS)" }] },
      "call_28",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("total(a, b);");
    expect(content).toContain("total(c);");
    expect(content).not.toContain("sum(");
  });

  test("replaces in Python files", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-py-");
    const filePath = join(workspace, "file.py");
    await writeFile(filePath, 'print("hello")\nprint("world")\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "replace", rule: "print($ARG)", replacement: "log($ARG)" }] },
      "call_29",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('log("hello")');
    expect(content).not.toContain("print");
  });

  test("replaces in Rust files", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-rs-");
    const filePath = join(workspace, "file.rs");
    await writeFile(filePath, 'println!("hello");\nprintln!("world");\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "replace", rule: "println!($ARGS)", replacement: "eprintln!($ARGS)" }] },
      "call_30",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("eprintln!");
    expect(content).not.toMatch(/(?<!e)println!/);
  });

  test("replaces in Go files", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-go-");
    const filePath = join(workspace, "file.go");
    await writeFile(filePath, 'package main\n\nfunc main() {\n\tprintln("hello")\n\tprintln("world")\n}\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      { path: filePath, edits: [{ op: "replace", rule: "println($ARG)", replacement: "print($ARG)" }] },
      "call_31",
    );
    expect(result.result.matches).toBe(2);
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("print(");
    expect(content).not.toContain("println(");
  });

  test("includes affectedSymbols in result", async () => {
    const workspace = dirs.createDir("acolyte-test-ast-affected-");
    const filePath = join(workspace, "file.ts");
    await writeFile(
      filePath,
      ['function processItems() { console.log("processing"); }', 'function other() { console.log("other"); }', ""].join(
        "\n",
      ),
      "utf8",
    );
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editCode.execute(
      {
        path: filePath,
        edits: [
          { op: "replace", rule: "console.log($ARG)", replacement: "logger.info($ARG)", withinSymbol: "processItems" },
        ],
      },
      "call_32",
    );
    expect(result.result.affectedSymbols).toEqual(["processItems"]);
  });
});

describe("scanCode", () => {
  test("rejects paths outside sandbox via dispatch", async () => {
    const workspace = dirs.createDir("acolyte-test-sandbox-scan-");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.scanCode.execute({ paths: ["/etc/hosts"], patterns: ["const $X"] }, "call_33"),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
    });
  });

  test("rejects unsupported single-file types", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-unsupported-");
    const filePath = join(workspace, "file.yaml");
    await writeFile(filePath, "foo: bar\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.scanCode.execute({ paths: [filePath], patterns: ["const $X"] }, "call_34"),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.scanCodeUnsupportedFile,
    });
  });

  test("finds matches with metavariable captures", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, 'console.log("hello");\nconsole.log("world");\nconst x = 1;\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute({ paths: [filePath], patterns: ["console.log($ARG)"] }, "call_35");
    const output = result.result.output;
    expect(output).toContain("scanned=1 matches=2");
    expect(output).toContain('{$ARG="hello"}');
  });

  test("returns no matches when pattern is absent", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-nomatch-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, "const x = 1;\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute({ paths: [filePath], patterns: ["console.log($ARG)"] }, "call_36");
    const output = result.result.output;
    expect(output).toContain("scanned=1 matches=0");
    expect(output).toContain("No matches.");
  });

  test("scans a directory recursively", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-dir-");
    await mkdir(join(workspace, "sub"), { recursive: true });
    await writeFile(join(workspace, "a.ts"), 'console.log("a");\n', "utf8");
    await writeFile(join(workspace, "sub", "b.ts"), 'console.log("b");\nconst y = 2;\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute({ paths: [workspace], patterns: ["console.log($ARG)"] }, "call_37");
    const output = result.result.output;
    expect(output).toContain("scanned=2 matches=2");
  });

  test("respects maxResults limit", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-limit-");
    const filePath = join(workspace, "file.ts");
    const lines = `${Array.from({ length: 10 }, (_, i) => `console.log("line${i}");`).join("\n")}\n`;
    await writeFile(filePath, lines, "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute(
      { paths: [filePath], patterns: ["console.log($ARG)"], maxResults: 3 },
      "call_38",
    );
    const output = result.result.output;
    expect(output).toContain("matches=3");
  });

  test("batches multiple patterns", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-batch-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, 'export function hello() {}\nexport const x = 1;\nconsole.log("test");\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute(
      { paths: [filePath], patterns: ["export function $NAME() {}", "console.log($ARG)"] },
      "call_39",
    );
    const output = result.result.output;
    expect(output).toContain("matches=2");
    expect(output).toContain("{$NAME=hello}");
    expect(output).toContain('{$ARG="test"}');
  });

  test("includes enclosingSymbol for match inside a function", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-enclosing-fn-");
    const filePath = join(workspace, "file.ts");
    await writeFile(
      filePath,
      ["function processItems() {", "  console.log('processing');", "}", ""].join("\n"),
      "utf8",
    );
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute({ paths: [filePath], patterns: ["console.log($ARG)"] }, "call_40");
    const output = result.result.output;
    expect(output).toContain("[processItems]");
  });

  test("includes enclosingSymbol for match inside a class", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-enclosing-class-");
    const filePath = join(workspace, "file.ts");
    await writeFile(
      filePath,
      ["class MyService {", "  run() {", "    console.log('run');", "  }", "}", ""].join("\n"),
      "utf8",
    );
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute({ paths: [filePath], patterns: ["console.log($ARG)"] }, "call_41");
    const output = result.result.output;
    expect(output).toContain("[run]");
  });

  test("enclosingSymbol is undefined at top-level", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-enclosing-top-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, "console.log('top-level');\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute({ paths: [filePath], patterns: ["console.log($ARG)"] }, "call_42");
    const output = result.result.output;
    expect(output).not.toMatch(/\[.*\]/);
    expect(output).toContain("console.log('top-level')");
  });

  test("includes enclosingSymbol for match inside a TypeScript type alias", async () => {
    const workspace = dirs.createDir("acolyte-test-scan-enclosing-type-");
    const filePath = join(workspace, "file.ts");
    await writeFile(filePath, 'type Status = "active" | "inactive";\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.scanCode.execute({ paths: [filePath], patterns: ['"active"'] }, "call_43");
    const output = result.result.output;
    expect(output).toContain("[Status]");
  });
});
