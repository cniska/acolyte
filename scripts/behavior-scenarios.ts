import { mkdir, writeFile } from "node:fs/promises";
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
};

async function writeWorkspaceFile(workspace: string, relativePath: string, content: string): Promise<void> {
  const filePath = join(workspace, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function createDocsLinkFixWorkspace(workspace: string): Promise<void> {
  await writeWorkspaceFile(
    workspace,
    "README.md",
    ["# Demo", "", "## Documentation", "- [Contributing](CONTRIBUTING.md)", ""].join("\n"),
  );
  await writeWorkspaceFile(
    workspace,
    "docs/README.md",
    ["# Docs", "", "## Reference", "- [Contributing](../CONTRIBUTING.md)", ""].join("\n"),
  );
  await writeWorkspaceFile(workspace, "CONTRIBUTING.md", ["# Contributing", "", "Contributing guide.", ""].join("\n"));
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

export const BEHAVIOR_SCENARIOS: BehaviorScenario[] = [
  {
    id: "docs-link-fix",
    description: "Tiny bounded docs edit across two named files.",
    prompt: "Fix the broken Contributing link references in README.md and docs/README.md, update only those files, then stop.",
    expectedChanges: ["README.md", "docs/README.md"],
    setup: createDocsLinkFixWorkspace,
  },
  {
    id: "single-file-bug-fix",
    description: "One-file bug fix with no extra exploration required.",
    prompt: "Fix clamp in src/clamp.ts so values already inside range are returned unchanged. Update only that file, then stop.",
    expectedChanges: ["src/clamp.ts"],
    setup: createSingleFileBugFixWorkspace,
  },
  {
    id: "add-focused-test",
    description: "Add a single regression test without touching implementation.",
    prompt: "Add a regression test in src/slug.test.ts covering empty-string input. Update only that file, then stop.",
    expectedChanges: ["src/slug.test.ts"],
    setup: createAddFocusedTestWorkspace,
  },
  {
    id: "two-file-rename",
    description: "Small two-file rename with explicit target files.",
    prompt:
      "Rename config key `defaultModel` to `appModel` in src/config.ts and src/config.test.ts. Update only those files, then stop.",
    expectedChanges: ["src/config.ts", "src/config.test.ts"],
    setup: createTwoFileRenameWorkspace,
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
