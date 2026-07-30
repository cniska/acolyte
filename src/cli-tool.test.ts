import { describe, expect, test } from "bun:test";
import { formatToolBody, parseToolInput, toolMode } from "./cli-tool";

type ToolDeps = Parameters<typeof toolMode>[1];

function createDeps(overrides?: Partial<ToolDeps>): { deps: ToolDeps; errors: () => string[] } {
  const errors: string[] = [];
  const deps: ToolDeps = {
    hasHelpFlag: () => false,
    printError: (msg) => errors.push(msg),
    commandHelp: () => {},
    ...overrides,
  };
  return { deps, errors: () => errors };
}

describe("parseToolInput", () => {
  test("treats zero arguments as empty input", () => {
    expect(parseToolInput([])).toEqual({ ok: true, input: {} });
  });

  test("passes a single JSON object through untouched", () => {
    expect(parseToolInput(['{"path":"src/index.ts","offset":2}'])).toEqual({
      ok: true,
      input: { path: "src/index.ts", offset: 2 },
    });
  });

  test("rejects malformed JSON and surfaces the parser message", () => {
    const parsed = parseToolInput(["{not json"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.message).toContain("Invalid JSON input:");
    expect(parsed.ok === false && parsed.message.length).toBeGreaterThan("Invalid JSON input:".length);
  });

  test("rejects JSON that is not an object", () => {
    for (const arg of ['"text"', "42", "[1,2]", "null"]) {
      const parsed = parseToolInput([arg]);
      expect(parsed.ok).toBe(false);
      expect(parsed.ok === false && parsed.message).toBe("Input must be a JSON object.");
    }
  });

  test("rejects more than one argument", () => {
    const parsed = parseToolInput(["src/**/*.ts", "extra"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.message).toContain("Usage: acolyte tool");
  });
});

describe("formatToolBody", () => {
  test("returns the result's output string without the envelope", () => {
    const body = formatToolBody({ result: { kind: "git-status", output: "M src/cli-tool.ts" } });
    expect(body).toBe("M src/cli-tool.ts");
    expect(body).not.toContain("result");
  });

  test("pretty-prints a result carrying no output string", () => {
    const body = formatToolBody({ result: { kind: "file-find", matches: 3 } });
    expect(body).toBe('{\n  "kind": "file-find",\n  "matches": 3\n}');
  });
});

describe("toolMode", () => {
  test("no arguments prints usage", async () => {
    const { deps, errors } = createDeps();
    await toolMode([], deps);
    expect(process.exitCode).toBe(1);
    expect(errors()[0]).toContain("Usage: acolyte tool");
    process.exitCode = 0;
  });

  test("help flag calls commandHelp", async () => {
    let called = false;
    const { deps } = createDeps({
      hasHelpFlag: () => true,
      commandHelp: () => {
        called = true;
      },
    });
    await toolMode(["file-find", '{"pattern":"*.ts"}'], deps);
    expect(called).toBe(true);
  });

  test("malformed input fails before any tool runs", async () => {
    const { deps, errors } = createDeps();
    await toolMode(["file-read", "{not json"], deps);
    expect(process.exitCode).toBe(1);
    expect(errors()[0]).toContain("Invalid JSON input:");
    process.exitCode = 0;
  });
});
