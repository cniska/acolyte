import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const behaviorScenarioIdSchema = z.enum([
  "docs-link-fix",
  "single-file-bug-fix",
  "add-focused-test",
  "two-file-rename",
]);

export type BehaviorScenarioId = z.infer<typeof behaviorScenarioIdSchema>;

export type BehaviorScenario = {
  id: BehaviorScenarioId;
  description: string;
  prompt: string;
  expectedChanges: string[];
  setup: (workspace: string) => Promise<void>;
  validate: (workspace: string) => Promise<string[]>;
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
  if (content.includes("return max;")) issues.push("src/clamp.ts still returns max for in-range values");
  return issues;
}

async function createAddFocusedTestWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "src/slug.ts",
    [
      "export function slugify(input: string): string {",
      "  return input.trim().toLowerCase().replace(/\\s+/g, \"-\");",
      "}",
      "",
    ].join("\n"),
  );
  await writeWorkspaceFile(
    workspace,
    "src/slug.test.ts",
    [
      "import { expect, test } from \"bun:test\";",
      "import { slugify } from \"./slug\";",
      "",
      "test(\"slugify collapses spaces\", () => {",
      "  expect(slugify(\"Hello World\")).toBe(\"hello-world\");",
      "});",
      "",
    ].join("\n"),
  );
}

async function validateAddFocusedTestWorkspace(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const content = await readWorkspaceFile(workspace, "src/slug.test.ts");
  if (!content.includes('expect(slugify("")).toBe("")')) {
    issues.push('src/slug.test.ts should include an empty-string regression assertion');
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
      "  defaultModel: \"gpt-5-mini\",",
      "};",
      "",
    ].join("\n"),
  );
  await writeWorkspaceFile(
    workspace,
    "src/config.test.ts",
    [
      "import { expect, test } from \"bun:test\";",
      "import { DEFAULT_CONFIG } from \"./config\";",
      "",
      "test(\"default config exposes defaultModel\", () => {",
      "  expect(DEFAULT_CONFIG.defaultModel).toBe(\"gpt-5-mini\");",
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
  if (!config.includes('appModel: "gpt-5-mini",')) issues.push("src/config.ts should update DEFAULT_CONFIG to appModel");
  if (config.includes("defaultModel")) issues.push("src/config.ts should not keep defaultModel");
  if (!testFile.includes("appModel")) issues.push("src/config.test.ts should assert appModel");
  if (testFile.includes("defaultModel")) issues.push("src/config.test.ts should not keep defaultModel");
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
    prompt: "Fix clamp in src/clamp.ts so values already inside range are returned unchanged. Update only that file, then stop.",
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
