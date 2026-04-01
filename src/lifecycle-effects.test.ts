import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { formatEffect, installEffect, lintEffect } from "./lifecycle-effects";
import { createRunContext, tempDir } from "./test-utils";

function ctxWith(overrides: Parameters<typeof createRunContext>[0] = {}) {
  return createRunContext({
    workspace: "/ws",
    policy: {
      ...createRunContext().policy,
      formatCommand: { bin: "fmt", args: ["--write"] },
      lintCommand: { bin: "lint", args: ["--fix"] },
    },
    ...overrides,
  });
}

describe("formatEffect", () => {
  test("returns done when workspace is undefined", () => {
    const ctx = ctxWith({ workspace: undefined });
    expect(formatEffect.run(ctx, ["/ws/src/a.ts"])).toEqual({ type: "done" });
  });

  test("returns done when no format command is configured", () => {
    const ctx = ctxWith({
      policy: { ...createRunContext().policy, formatCommand: undefined },
    });
    expect(formatEffect.run(ctx, ["/ws/src/a.ts"])).toEqual({ type: "done" });
  });

  test("returns done when paths are empty", () => {
    const ctx = ctxWith();
    expect(formatEffect.run(ctx, [])).toEqual({ type: "done" });
  });
});

const { createDir, cleanupDirs } = tempDir();
afterEach(() => cleanupDirs());

describe("installEffect", () => {
  test("returns done when workspace is undefined", () => {
    const ctx = ctxWith({ workspace: undefined });
    expect(installEffect.run(ctx, [])).toEqual({ type: "done" });
  });

  test("returns done when no install command is configured", () => {
    const ctx = ctxWith({
      policy: { ...createRunContext().policy, installCommand: undefined },
    });
    expect(installEffect.run(ctx, [])).toEqual({ type: "done" });
  });

  test("skips install when depsDir exists", () => {
    const ws = createDir("acolyte-install-");
    mkdirSync(join(ws, "node_modules"), { recursive: true });
    const ctx = ctxWith({
      workspace: ws,
      policy: { ...createRunContext().policy, installCommand: { bin: "npm", args: ["install"] } },
    });
    ctx.session.workspaceProfile = { depsDir: "node_modules" };
    expect(installEffect.run(ctx, [])).toEqual({ type: "done" });
  });
});

describe("lintEffect", () => {
  test("returns done when workspace is undefined", () => {
    const ctx = ctxWith({ workspace: undefined });
    expect(lintEffect.run(ctx, ["/ws/src/a.ts"])).toEqual({ type: "done" });
  });

  test("returns done when no lint command is configured", () => {
    const ctx = ctxWith({
      policy: { ...createRunContext().policy, lintCommand: undefined },
    });
    expect(lintEffect.run(ctx, ["/ws/src/a.ts"])).toEqual({ type: "done" });
  });

  test("returns done when paths are empty", () => {
    const ctx = ctxWith();
    expect(lintEffect.run(ctx, [])).toEqual({ type: "done" });
  });
});
