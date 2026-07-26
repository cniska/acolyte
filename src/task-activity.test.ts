import { describe, expect, test } from "bun:test";
import { createTaskActivity, renderTaskActivity } from "./task-activity";
import type { ToolCallRecord } from "./tool-contract";

const WRITE = new Set(["edit", "write"]);
const DISCOVERY = new Set(["file-read", "file-search"]);

function call(partial: Partial<ToolCallRecord> & { toolName: string }): ToolCallRecord {
  return { args: {}, status: "succeeded", ...partial };
}

describe("createTaskActivity", () => {
  test("collects unique changed files from write tools only", () => {
    const activity = createTaskActivity(
      [
        call({ toolName: "edit", args: { path: "src/a.ts" } }),
        call({ toolName: "read", args: { path: "src/b.ts" } }),
        call({ toolName: "write", args: { path: "src/a.ts" } }),
        call({ toolName: "write", args: { paths: ["src/c.ts", "src/d.ts"] } }),
      ],
      WRITE,
    );
    expect(activity.filesChanged).toEqual(["src/a.ts", "src/c.ts", "src/d.ts"]);
  });

  test("records commands with failure derived from status and exit code", () => {
    const activity = createTaskActivity(
      [
        call({ toolName: "shell-run", command: "bun test" }),
        call({ toolName: "shell-run", command: "bun run build", status: "failed" }),
        call({ toolName: "shell-run", command: "grep x", exitCode: 2 }),
      ],
      WRITE,
    );
    expect(activity.commands).toEqual([
      { command: "bun test", failed: false },
      { command: "bun run build", failed: true },
      { command: "grep x", failed: true },
    ]);
  });

  test("failed writes are excluded from changed files and reported as errors", () => {
    const activity = createTaskActivity(
      [call({ toolName: "edit", args: { path: "src/a.ts" }, status: "failed" })],
      WRITE,
    );
    expect(activity.filesChanged).toEqual([]);
    expect(activity.errors).toEqual([{ tool: "edit", detail: "src/a.ts" }]);
  });

  test("command failures surface in commands, not errors, to avoid duplication", () => {
    const activity = createTaskActivity(
      [call({ toolName: "shell-run", command: "bun test", status: "failed" })],
      WRITE,
    );
    expect(activity.errors).toEqual([]);
    expect(activity.commands).toEqual([{ command: "bun test", failed: true }]);
  });

  test("caps an overlong command string", () => {
    const long = `echo ${"x".repeat(500)}`;
    const activity = createTaskActivity([call({ toolName: "shell-run", command: long })], WRITE);
    expect(activity.commands[0]?.command.length).toBe(200);
    expect(activity.commands[0]?.command.endsWith("…")).toBe(true);
  });

  test("a path-less failed tool records an empty detail", () => {
    const activity = createTaskActivity([call({ toolName: "gh-pr-create", args: {}, status: "failed" })], WRITE);
    expect(activity.errors).toEqual([{ tool: "gh-pr-create", detail: "" }]);
  });

  test("failed discovery calls are excluded — a guessed path is not a durable fact", () => {
    const activity = createTaskActivity(
      [
        call({ toolName: "file-read", args: { path: "src/nope.ts" }, status: "failed" }),
        call({ toolName: "edit", args: { path: "src/a.ts" }, status: "failed" }),
      ],
      WRITE,
      DISCOVERY,
    );
    expect(activity.errors).toEqual([{ tool: "edit", detail: "src/a.ts" }]);
  });
});

describe("renderTaskActivity", () => {
  test("returns empty string when there is no activity", () => {
    expect(renderTaskActivity({ filesChanged: [], commands: [], errors: [] })).toBe("");
  });

  test("renders only the non-empty sections under a header", () => {
    const rendered = renderTaskActivity({
      filesChanged: ["src/a.ts"],
      commands: [{ command: "bun test", failed: true }],
      errors: [{ tool: "edit", detail: "src/b.ts" }],
    });
    expect(rendered).toBe("Files changed:\n- src/a.ts\nCommands:\n- bun test (failed)\nErrors:\n- edit: src/b.ts");
  });

  test("renders a path-less error as the tool name alone", () => {
    const rendered = renderTaskActivity({
      filesChanged: [],
      commands: [],
      errors: [{ tool: "gh-pr-create", detail: "" }],
    });
    expect(rendered).toBe("Errors:\n- gh-pr-create");
  });
});
