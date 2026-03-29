import { describe, expect, test } from "bun:test";
import { formatEffect, lintEffect } from "./lifecycle-effects";
import { createRunContext } from "./test-utils";
import { createSessionContext, recordCall } from "./tool-guards";
import { WRITE_TOOL_SET } from "./tool-registry";

function ctxWithWrites(overrides: Parameters<typeof createRunContext>[0] = {}) {
  const session = createSessionContext("task_1", WRITE_TOOL_SET);
  recordCall(session, "file-edit", { path: "/ws/src/a.ts" }, undefined, "succeeded");
  return createRunContext({
    workspace: "/ws",
    taskId: "task_1",
    session,
    policy: {
      ...createRunContext().policy,
      formatCommand: { bin: "fmt", args: ["--write"] },
      lintCommand: { bin: "lint", args: ["--fix"] },
    },
    ...overrides,
  });
}

describe("formatEffect", () => {
  test("declares work-only applicability", () => {
    expect(formatEffect.modes).toEqual(["work"]);
  });

  test("returns done when workspace is undefined", () => {
    const ctx = ctxWithWrites({ workspace: undefined });
    expect(formatEffect.run(ctx)).toEqual({ type: "done" });
  });

  test("returns done when no format command is configured", () => {
    const ctx = ctxWithWrites({
      policy: { ...createRunContext().policy, formatCommand: undefined },
    });
    expect(formatEffect.run(ctx)).toEqual({ type: "done" });
  });

  test("returns done when no write tools were used in the task", () => {
    const ctx = createRunContext({
      workspace: "/ws",
      taskId: "task_empty",
      session: createSessionContext("task_empty", WRITE_TOOL_SET),
      policy: {
        ...createRunContext().policy,
        formatCommand: { bin: "fmt", args: ["--write"] },
      },
    });
    expect(formatEffect.run(ctx)).toEqual({ type: "done" });
  });
});

describe("lintEffect", () => {
  test("declares work-only applicability", () => {
    expect(lintEffect.modes).toEqual(["work"]);
  });

  test("returns done when workspace is undefined", () => {
    const ctx = ctxWithWrites({ workspace: undefined });
    expect(lintEffect.run(ctx)).toEqual({ type: "done" });
  });

  test("returns done when no lint command is configured", () => {
    const ctx = ctxWithWrites({
      policy: { ...createRunContext().policy, lintCommand: undefined },
    });
    expect(lintEffect.run(ctx)).toEqual({ type: "done" });
  });

  test("returns done when no write tools were used in the task", () => {
    const ctx = createRunContext({
      workspace: "/ws",
      taskId: "task_empty",
      session: createSessionContext("task_empty", WRITE_TOOL_SET),
      policy: {
        ...createRunContext().policy,
        lintCommand: { bin: "lint", args: ["--fix"] },
      },
    });
    expect(lintEffect.run(ctx)).toEqual({ type: "done" });
  });
});
