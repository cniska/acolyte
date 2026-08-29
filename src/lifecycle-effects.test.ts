import { describe, expect, test } from "bun:test";
import { formatEffect, installEffect, lintEffect } from "./lifecycle-effects";
import { createRunContext } from "./test-utils";

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
  test("returns done when workspace is undefined", async () => {
    const ctx = ctxWith({ workspace: undefined });
    expect(await formatEffect.run(ctx, { paths: ["/ws/src/a.ts"] })).toEqual({ type: "done" });
  });

  test("returns done when no format command is configured", async () => {
    const ctx = ctxWith({
      policy: { ...createRunContext().policy, formatCommand: undefined },
    });
    expect(await formatEffect.run(ctx, { paths: ["/ws/src/a.ts"] })).toEqual({ type: "done" });
  });

  test("returns done when paths are empty", async () => {
    const ctx = ctxWith();
    expect(await formatEffect.run(ctx, { paths: [] })).toEqual({ type: "done" });
  });
});

describe("installEffect", () => {
  test("returns done when workspace is undefined", async () => {
    const ctx = ctxWith({ workspace: undefined });
    expect(await installEffect.run(ctx, { paths: [] })).toEqual({ type: "done" });
  });

  test("returns done when no install command is configured", async () => {
    const ctx = ctxWith({
      policy: { ...createRunContext().policy, installCommand: undefined },
    });
    expect(await installEffect.run(ctx, { paths: [] })).toEqual({ type: "done" });
  });
});

describe("lintEffect", () => {
  test("returns done when workspace is undefined", async () => {
    const ctx = ctxWith({ workspace: undefined });
    expect(await lintEffect.run(ctx, { paths: ["/ws/src/a.ts"] })).toEqual({ type: "done" });
  });

  test("returns done when no lint command is configured", async () => {
    const ctx = ctxWith({
      policy: { ...createRunContext().policy, lintCommand: undefined },
    });
    expect(await lintEffect.run(ctx, { paths: ["/ws/src/a.ts"] })).toEqual({ type: "done" });
  });

  test("returns done when paths are empty", async () => {
    const ctx = ctxWith();
    expect(await lintEffect.run(ctx, { paths: [] })).toEqual({ type: "done" });
  });
});
