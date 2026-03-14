import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const behaviorScenarioIdSchema = z.enum([
  "docs-link-fix",
  "single-file-bug-fix",
  "add-focused-test",
  "two-file-rename",
  "two-file-deps-rename",
  "bounded-return-fix",
  "scoped-edit-code-rename",
]);

export type BehaviorScenarioId = z.infer<typeof behaviorScenarioIdSchema>;

export type BehaviorScenario = {
  id: BehaviorScenarioId;
  description: string;
  prompt: string;
  expectedChanges: string[];
  setup: (workspace: string) => Promise<void>;
  validate: (workspace: string) => Promise<string[]>;
  validateTrace?: (traceLines: string[]) => string[];
};

async function writeWorkspaceFile(workspace: string, relativePath: string, content: string): Promise<void> {
  const filePath = join(workspace, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function readWorkspaceFile(workspace: string, relativePath: string): Promise<string> {
  return readFile(join(workspace, relativePath), "utf8");
}

async function createDocsLinkFixWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "README.md",
    ["# Demo", "", "## Documentation", "- [Contributing](docs/contributing.md)", ""].join("\n"),
  );
  await writeWorkspaceFile(
    workspace,
    "docs/README.md",
    ["# Docs", "", "## Reference", "- [Contributing](contributing.md)", ""].join("\n"),
  );
  await writeWorkspaceFile(workspace, "CONTRIBUTING.md", ["# Contributing", "", "Contributing guide.", ""].join("\n"));
}

async function validateDocsLinkFixWorkspace(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const rootReadme = await readWorkspaceFile(workspace, "README.md");
  const docsReadme = await readWorkspaceFile(workspace, "docs/README.md");
  if (!rootReadme.includes("[Contributing](CONTRIBUTING.md)")) {
    issues.push("README.md should link to CONTRIBUTING.md");
  }
  if (!docsReadme.includes("[Contributing](../CONTRIBUTING.md)")) {
    issues.push("docs/README.md should link to ../CONTRIBUTING.md");
  }
  return issues;
}

async function createSingleFileBugFixWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "src/clamp.ts",
    [
      "export function clamp(value: number, min: number, max: number): number {",
      "  if (value < min) return min;",
      "  if (value > max) return max;",
      "  return max;",
      "}",
      "",
    ].join("\n"),
  );
}

async function validateSingleFileBugFixWorkspace(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const content = await readWorkspaceFile(workspace, "src/clamp.ts");
  if (!content.includes("return value;")) issues.push("src/clamp.ts should return value when already in range");
  if (!content.includes("if (value > max) return max;")) {
    issues.push("src/clamp.ts should still clamp values above max");
  }
  return issues;
}

async function createAddFocusedTestWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "src/slug.ts",
    [
      "export function slugify(input: string): string {",
      '  return input.trim().toLowerCase().replace(/\\s+/g, "-");',
      "}",
      "",
    ].join("\n"),
  );
  await writeWorkspaceFile(
    workspace,
    "src/slug.test.ts",
    [
      'import { expect, test } from "bun:test";',
      'import { slugify } from "./slug";',
      "",
      'test("slugify collapses spaces", () => {',
      '  expect(slugify("Hello World")).toBe("hello-world");',
      "});",
      "",
    ].join("\n"),
  );
}

async function validateAddFocusedTestWorkspace(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const content = await readWorkspaceFile(workspace, "src/slug.test.ts");
  if (!content.includes('expect(slugify("")).toBe("")')) {
    issues.push("src/slug.test.ts should include an empty-string regression assertion");
  }
  return issues;
}

async function createTwoFileRenameWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "src/config.ts",
    [
      "export type AppConfig = {",
      "  defaultModel: string;",
      "};",
      "",
      "export const DEFAULT_CONFIG: AppConfig = {",
      '  defaultModel: "gpt-5-mini",',
      "};",
      "",
    ].join("\n"),
  );
  await writeWorkspaceFile(
    workspace,
    "src/config.test.ts",
    [
      'import { expect, test } from "bun:test";',
      'import { DEFAULT_CONFIG } from "./config";',
      "",
      'test("default config exposes defaultModel", () => {',
      '  expect(DEFAULT_CONFIG.defaultModel).toBe("gpt-5-mini");',
      "});",
      "",
    ].join("\n"),
  );
}

async function validateTwoFileRenameWorkspace(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const config = await readWorkspaceFile(workspace, "src/config.ts");
  const testFile = await readWorkspaceFile(workspace, "src/config.test.ts");
  if (!config.includes("appModel: string;")) issues.push("src/config.ts should rename defaultModel to appModel");
  if (!config.includes('appModel: "gpt-5-mini",'))
    issues.push("src/config.ts should update DEFAULT_CONFIG to appModel");
  if (config.includes("defaultModel")) issues.push("src/config.ts should not keep defaultModel");
  if (!testFile.includes("appModel")) issues.push("src/config.test.ts should assert appModel");
  if (testFile.includes("defaultModel")) issues.push("src/config.test.ts should not keep defaultModel");
  return issues;
}

async function createTwoFileDepsRenameWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "src/cli-run.ts",
    [
      "type ParsedRunArgs = { files: string[]; prompt: string; workspace?: string; model?: string };",
      "",
      "type RunModeDeps = {",
      "  apiUrlForPort: (port: number) => string;",
      "  appModel: string;",
      "  createSession: (model: string) => { model: string };",
      "};",
      "",
      "export async function runMode(args: string[], deps: RunModeDeps): Promise<void> {",
      '  const parsed: ParsedRunArgs = { files: [], prompt: args.join(" "), model: undefined };',
      "  const { apiUrlForPort, appModel, createSession } = deps;",
      "  apiUrlForPort(6767);",
      "  if (!parsed.prompt) return;",
      "  const session = createSession(parsed.model ?? appModel);",
      "  void session;",
      "}",
      "",
    ].join("\n"),
  );
  await writeWorkspaceFile(
    workspace,
    "src/cli-skill.ts",
    [
      "type ParsedSkillArgs = { skillName: string; prompt: string; model?: string };",
      "",
      "type SkillModeDeps = {",
      "  apiUrlForPort: (port: number) => string;",
      "  appModel: string;",
      "  createSession: (model: string) => { model: string };",
      "};",
      "",
      "export async function skillMode(args: string[], deps: SkillModeDeps): Promise<void> {",
      '  const parsed: ParsedSkillArgs = { skillName: args[0] ?? "", prompt: args.slice(1).join(" "), model: undefined };',
      "  const { apiUrlForPort, appModel, createSession } = deps;",
      "  apiUrlForPort(6767);",
      "  if (!parsed.prompt) return;",
      "  const session = createSession(parsed.model ?? appModel);",
      "  void session;",
      "}",
      "",
    ].join("\n"),
  );
}

async function validateTwoFileDepsRenameWorkspace(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const runFile = await readWorkspaceFile(workspace, "src/cli-run.ts");
  const skillFile = await readWorkspaceFile(workspace, "src/cli-skill.ts");
  for (const [path, content] of [
    ["src/cli-run.ts", runFile],
    ["src/cli-skill.ts", skillFile],
  ] as const) {
    if (content.includes("appModel")) issues.push(`${path} should not keep appModel`);
    if (!content.includes("defaultModel")) issues.push(`${path} should rename appModel to defaultModel`);
  }
  return issues;
}

function validateTwoFileDepsRenameTrace(traceLines: string[]): string[] {
  const issues: string[] = [];
  const toolCallLines = traceLines.filter((line) => line.includes("event=lifecycle.tool.call"));
  const readRunCalls = toolCallLines.filter(
    (line) => line.includes("tool=read-file") && line.includes("src/cli-run.ts"),
  ).length;
  const readSkillCalls = toolCallLines.filter(
    (line) => line.includes("tool=read-file") && line.includes("src/cli-skill.ts"),
  ).length;
  const searchCalls = toolCallLines.filter((line) => line.includes("tool=search-files")).length;
  const editRunCalls = toolCallLines.filter(
    (line) => line.includes("tool=edit-file") && line.includes("path=src/cli-run.ts"),
  ).length;
  const editSkillCalls = toolCallLines.filter(
    (line) => line.includes("tool=edit-file") && line.includes("path=src/cli-skill.ts"),
  ).length;

  const firstReadTools = toolCallLines
    .slice(0, 2)
    .filter((line) => line.includes("tool=read-file"))
    .map((line) => (line.includes("src/cli-run.ts") ? "run" : line.includes("src/cli-skill.ts") ? "skill" : "other"));
  if (!(firstReadTools.includes("run") && firstReadTools.includes("skill"))) {
    issues.push("first two tool calls should read src/cli-run.ts and src/cli-skill.ts");
  }
  if (toolCallLines.some((line) => line.includes("tool=find-files"))) {
    issues.push("two-file deps rename should not use find-files");
  }
  if (readRunCalls > 1) issues.push(`should read src/cli-run.ts at most once, saw ${readRunCalls}`);
  if (readSkillCalls > 1) issues.push(`should read src/cli-skill.ts at most once, saw ${readSkillCalls}`);
  if (searchCalls > 1) issues.push(`should use at most one scoped search-files call, saw ${searchCalls}`);
  if (editRunCalls > 1) issues.push(`should edit src/cli-run.ts at most once, saw ${editRunCalls}`);
  if (editSkillCalls > 1) issues.push(`should edit src/cli-skill.ts at most once, saw ${editSkillCalls}`);

  const summaryLine = [...traceLines].reverse().find((line) => line.includes("event=lifecycle.summary"));
  if (summaryLine?.includes("lifecycle_signal=done") && summaryLine.includes("has_error=true")) {
    issues.push("should not finish with done while lifecycle summary still reports an error");
  }

  return issues;
}

async function createBoundedReturnFixWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "src/lifecycle-state.ts",
    [
      'import type { RunContext } from "./lifecycle-contract";',
      'import { scopedCallLog } from "./tool-guards";',
      'import { WRITE_TOOL_SET } from "./tool-registry";',
      "",
      "export function acceptedLifecycleSignal(ctx: RunContext): string | undefined {",
      "  const signal = ctx.result?.signal;",
      "  if (!signal) return undefined;",
      "  if (ctx.currentError) return undefined;",
      '  if (signal === "no_op" && taskHasWrites(ctx)) return undefined;',
      '  if (signal === "done" || signal === "no_op" || signal === "blocked") return signal;',
      "  return undefined;",
      "}",
      "",
      "function taskHasWrites(ctx: RunContext): boolean {",
      "  return scopedCallLog(ctx.session, ctx.taskId).some((entry) => WRITE_TOOL_SET.has(entry.toolName));",
      "}",
      "",
      "export function updateRepeatedFailureState(ctx: RunContext): void {",
      "  const previous = ctx.lifecycleState.repeatedFailure;",
      "  if (!previous) return;",
      "  ctx.lifecycleState.repeatedFailure = { ...previous, count: previous.count + 1 };",
      "}",
      "",
      "function failureSignatureForError(ctx: RunContext): string | undefined {",
      "  if (!ctx.currentError) return undefined;",
      "  return ctx.currentError.message.trim() || undefined;",
      "}",
      "",
      "function normalizeFailureMessage(message: string | undefined): string | undefined {",
      "  if (!message) return undefined;",
      '  const normalized = message.replace(/\\s+/g, " ").trim();',
      "  return normalized.length > 0 ? normalized : undefined;",
      "}",
      "",
    ].join("\n"),
  );
}

async function validateBoundedReturnFixWorkspace(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const content = await readWorkspaceFile(workspace, "src/lifecycle-state.ts");
  if (content.includes("return undefined;")) {
    issues.push("src/lifecycle-state.ts should not keep return undefined; statements");
  }
  if (!content.includes("if (!signal) return;")) {
    issues.push("acceptedLifecycleSignal should use bare return for missing signal");
  }
  if (!content.includes("if (!ctx.currentError) return;")) {
    issues.push("failureSignatureForError should use bare return for missing currentError");
  }
  if (!content.includes("if (!message) return;")) {
    issues.push("normalizeFailureMessage should use bare return for missing message");
  }
  return issues;
}

function validateBoundedReturnFixTrace(traceLines: string[]): string[] {
  const issues: string[] = [];
  const toolCallLines = traceLines.filter((line) => line.includes("event=lifecycle.tool.call"));
  const toolCalls = toolCallLines.map((line) => ({
    line,
    tool: line.match(/(?:^|\s)tool=([^\s]+)/)?.[1] ?? "",
    path: line.match(/(?:^|\s)path=([^\s]+)/)?.[1] ?? "",
  }));

  const firstTool = toolCalls[0];
  if (!firstTool || firstTool.tool !== "read-file" || !firstTool.line.includes("src/lifecycle-state.ts")) {
    issues.push("first tool call should be read-file on src/lifecycle-state.ts");
  }

  if (toolCalls.some((call) => call.tool === "find-files")) {
    issues.push("bounded single-file scenario should not use find-files");
  }

  if (toolCalls.some((call) => call.tool === "edit-code")) {
    issues.push("bounded single-file scenario should not use edit-code");
  }

  if (toolCalls.some((call) => call.tool === "search-files" && call.line.includes("src/lifecycle-state.ts"))) {
    issues.push("bounded single-file scenario should not search the already-read target file");
  }

  const sameFileEditCalls = toolCalls.filter(
    (call) => call.tool === "edit-file" && call.path === "src/lifecycle-state.ts",
  ).length;
  if (sameFileEditCalls > 2) {
    issues.push(`bounded single-file scenario should use at most 2 edit-file calls, saw ${sameFileEditCalls}`);
  }

  const verifyModeIndex = traceLines.findIndex(
    (line) => line.includes("event=lifecycle.mode.changed") && line.includes("to=verify"),
  );
  const firstVerifyCommandIndex = traceLines.findIndex(
    (line) => line.includes("event=lifecycle.tool.call") && line.includes("tool=run-command"),
  );
  if (verifyModeIndex >= 0 && firstVerifyCommandIndex > verifyModeIndex) {
    const verifyPrelude = traceLines.slice(verifyModeIndex + 1, firstVerifyCommandIndex);
    const badVerifyPrelude = verifyPrelude.some(
      (line) =>
        line.includes("event=lifecycle.tool.call") &&
        (line.includes("tool=read-file") ||
          line.includes("tool=search-files") ||
          line.includes("tool=scan-code") ||
          line.includes("tool=git-diff")) &&
        line.includes("src/lifecycle-state.ts"),
    );
    if (badVerifyPrelude) {
      issues.push("verify mode should run the verify command before rereading or diffing src/lifecycle-state.ts");
    }
  }

  return issues;
}

async function createScopedEditCodeRenameWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "src/code-ops.ts",
    [
      "export function scanCode(results: string[]): string {",
      "  const totalMatches = () => results.reduce((sum, result) => sum + result.length, 0);",
      "  const scanFile = (items: string[]): string[] => {",
      "    const output: string[] = [];",
      "    for (const result of items) {",
      "      output.push(result.toUpperCase());",
      "    }",
      "    return output;",
      "  };",
      "  const lines = scanFile(results);",
      "  return totalMatches() + ':' + lines.join(',');",
      "}",
      "",
    ].join("\n"),
  );
}

async function validateScopedEditCodeRenameWorkspace(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const content = await readWorkspaceFile(workspace, "src/code-ops.ts");
  if (!content.includes("for (const patternResult of items)")) {
    issues.push("scanFile loop variable should be renamed to patternResult");
  }
  if (!content.includes("output.push(patternResult.toUpperCase());")) {
    issues.push("scanFile loop body should use patternResult");
  }
  if (!content.includes("results.reduce((sum, result) => sum + result.length, 0)")) {
    issues.push("totalMatches reducer should keep the outer result variable unchanged");
  }
  if (content.includes("sum + patternResult.length")) {
    issues.push("outer totalMatches reducer should not rename result to patternResult");
  }
  return issues;
}

function validateScopedEditCodeRenameTrace(traceLines: string[]): string[] {
  const issues: string[] = [];
  const toolCallLines = traceLines.filter((line) => line.includes("event=lifecycle.tool.call"));
  const firstTool = toolCallLines[0];
  if (!firstTool || !firstTool.includes("tool=read-file") || !firstTool.includes("src/code-ops.ts")) {
    issues.push("first tool call should be read-file on src/code-ops.ts");
  }
  const editCodeCalls = toolCallLines.filter(
    (line) => line.includes("tool=edit-code") && line.includes("path=src/code-ops.ts"),
  ).length;
  if (editCodeCalls === 0) issues.push("scoped edit-code scenario should use edit-code on src/code-ops.ts");
  if (editCodeCalls > 2) {
    issues.push(`scoped edit-code scenario should use at most 2 edit-code calls, saw ${editCodeCalls}`);
  }
  if (toolCallLines.some((line) => line.includes("tool=edit-file") && line.includes("path=src/code-ops.ts"))) {
    issues.push("scoped edit-code scenario should not fall back to edit-file on src/code-ops.ts");
  }
  return issues;
}

export const BEHAVIOR_SCENARIOS: BehaviorScenario[] = [
  {
    id: "docs-link-fix",
    description: "Tiny bounded docs edit across two named files.",
    prompt:
      "Fix the broken Contributing links so README.md links to CONTRIBUTING.md and docs/README.md links to ../CONTRIBUTING.md. Update only those files, then stop.",
    expectedChanges: ["README.md", "docs/README.md"],
    setup: createDocsLinkFixWorkspace,
    validate: validateDocsLinkFixWorkspace,
  },
  {
    id: "single-file-bug-fix",
    description: "One-file bug fix with no extra exploration required.",
    prompt:
      "Fix clamp in src/clamp.ts so values already inside range are returned unchanged. Update only that file, then stop.",
    expectedChanges: ["src/clamp.ts"],
    setup: createSingleFileBugFixWorkspace,
    validate: validateSingleFileBugFixWorkspace,
  },
  {
    id: "add-focused-test",
    description: "Add a single regression test without touching implementation.",
    prompt: "Add a regression test in src/slug.test.ts covering empty-string input. Update only that file, then stop.",
    expectedChanges: ["src/slug.test.ts"],
    setup: createAddFocusedTestWorkspace,
    validate: validateAddFocusedTestWorkspace,
  },
  {
    id: "two-file-rename",
    description: "Small two-file rename with explicit target files.",
    prompt:
      "Rename config key `defaultModel` to `appModel` in src/config.ts and src/config.test.ts. Update only those files, then stop.",
    expectedChanges: ["src/config.ts", "src/config.test.ts"],
    setup: createTwoFileRenameWorkspace,
    validate: validateTwoFileRenameWorkspace,
  },
  {
    id: "two-file-deps-rename",
    description: "Explicit two-file deps rename with separated occurrences in each file.",
    prompt:
      "In src/cli-run.ts and src/cli-skill.ts, rename the RunModeDeps and SkillModeDeps property name `appModel` to `defaultModel` and update only the corresponding destructuring and property reads in those two files. Do not change any other behavior. Stop when those two files are updated.",
    expectedChanges: ["src/cli-run.ts", "src/cli-skill.ts"],
    setup: createTwoFileDepsRenameWorkspace,
    validate: validateTwoFileDepsRenameWorkspace,
    validateTrace: validateTwoFileDepsRenameTrace,
  },
  {
    id: "bounded-return-fix",
    description: "Bounded one-file literal rewrite with no rediscovery on the target file.",
    prompt:
      "In src/lifecycle-state.ts, replace each 'return undefined;' with 'return;' where the function already returns undefined. Update only that file, then stop.",
    expectedChanges: ["src/lifecycle-state.ts"],
    setup: createBoundedReturnFixWorkspace,
    validate: validateBoundedReturnFixWorkspace,
    validateTrace: validateBoundedReturnFixTrace,
  },
  {
    id: "scoped-edit-code-rename",
    description: "Scoped helper-only rename using edit-code with within.",
    prompt:
      'In src/code-ops.ts, rename the loop variable `result` to `patternResult` inside the `scanFile` helper only. Use `edit-code` with a structured rename edit like { op: "rename", from: "result", to: "patternResult", withinSymbol: "scanFile" }. Update only that file, then stop.',
    expectedChanges: ["src/code-ops.ts"],
    setup: createScopedEditCodeRenameWorkspace,
    validate: validateScopedEditCodeRenameWorkspace,
    validateTrace: validateScopedEditCodeRenameTrace,
  },
];

export const BEHAVIOR_SCENARIO_LIST = BEHAVIOR_SCENARIOS.map(({ id, description, prompt, expectedChanges }) => ({
  id,
  description,
  prompt,
  expectedChanges,
}));

export const BEHAVIOR_SCENARIO_BY_ID: Record<BehaviorScenarioId, BehaviorScenario> = Object.fromEntries(
  BEHAVIOR_SCENARIOS.map((scenario) => [scenario.id, scenario]),
) as Record<BehaviorScenarioId, BehaviorScenario>;

export function parseBehaviorScenarioId(input: string): BehaviorScenarioId {
  return behaviorScenarioIdSchema.parse(input);
}
