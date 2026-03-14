import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const behaviorScenarioIdSchema = z.enum([
  "docs-link-fix",
  "single-file-bug-fix",
  "add-focused-test",
  "two-file-rename",
  "bounded-return-fix",
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
      '  return ctx.currentError.message.trim() || undefined;',
      "}",
      "",
      "function normalizeFailureMessage(message: string | undefined): string | undefined {",
      "  if (!message) return undefined;",
      "  const normalized = message.replace(/\\s+/g, \" \").trim();",
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
    id: "bounded-return-fix",
    description: "Bounded one-file literal rewrite with no rediscovery on the target file.",
    prompt:
      "In src/lifecycle-state.ts, replace each 'return undefined;' with 'return;' where the function already returns undefined. Update only that file, then stop.",
    expectedChanges: ["src/lifecycle-state.ts"],
    setup: createBoundedReturnFixWorkspace,
    validate: validateBoundedReturnFixWorkspace,
    validateTrace: validateBoundedReturnFixTrace,
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
