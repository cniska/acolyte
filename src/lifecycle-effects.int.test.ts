import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { installEffect } from "./lifecycle-effects";
import { createRunContext, tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(() => cleanupDirs());

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

describe("installEffect", () => {
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
