import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attachLifecycleEffectHandlers } from "./lifecycle-effects";
import { createRunContext, tempDir } from "./test-utils";
import { toolsForAgent } from "./tool-registry";

const { createDir, cleanupDirs } = tempDir();
afterEach(() => cleanupDirs());

describe("lifecycle effects through tool dispatch", () => {
  test("format effect fires after write tool succeeds", async () => {
    const workspace = createDir("acolyte-effect-format-");
    await writeFile(join(workspace, "demo.ts"), "const   x=1\n", "utf8");

    const { tools, session } = toolsForAgent({ workspace });
    const debugEvents: Array<{ event: string }> = [];
    const ctx = createRunContext({
      workspace,
      session,
      debug: (event) => debugEvents.push({ event }),
      policy: {
        ...createRunContext().policy,
        formatCommand: { bin: "bunx", args: ["biome", "check", "--write", "$FILES"] },
      },
    });
    attachLifecycleEffectHandlers(ctx, session);

    await tools.editFile.execute(
      { path: join(workspace, "demo.ts"), edits: [{ find: "x=1", replace: "x = 1" }] },
      "call_1",
    );

    expect(debugEvents.some((e) => e.event === "lifecycle.effect.format")).toBe(true);
  });

  test("effects do not fire for read tools", async () => {
    const workspace = createDir("acolyte-effect-read-");
    await writeFile(join(workspace, "a.txt"), "ok", "utf8");

    const { tools, session } = toolsForAgent({ workspace });
    const debugEvents: Array<{ event: string }> = [];
    const ctx = createRunContext({
      workspace,
      session,
      debug: (event) => debugEvents.push({ event }),
      policy: {
        ...createRunContext().policy,
        formatCommand: { bin: "bunx", args: ["biome", "check", "--write", "$FILES"] },
      },
    });
    attachLifecycleEffectHandlers(ctx, session);

    await tools.readFile.execute({ path: join(workspace, "a.txt") }, "call_2");

    expect(debugEvents.some((e) => e.event === "lifecycle.effect.format")).toBe(false);
  });

  test("install effect skips when depsDir exists", async () => {
    const workspace = createDir("acolyte-effect-install-");
    mkdirSync(join(workspace, "node_modules"), { recursive: true });
    await writeFile(join(workspace, "src.ts"), "const x = 1;\n", "utf8");

    const { tools, session } = toolsForAgent({ workspace });
    const debugEvents: Array<{ event: string }> = [];
    const ctx = createRunContext({
      workspace,
      session,
      debug: (event) => debugEvents.push({ event }),
      policy: {
        ...createRunContext().policy,
        installCommand: { bin: "npm", args: ["install"] },
      },
    });
    session.workspaceProfile = { depsDir: "node_modules" };
    attachLifecycleEffectHandlers(ctx, session);

    await tools.readFile.execute({ path: join(workspace, "src.ts") }, "call_3");

    expect(debugEvents.some((e) => e.event === "lifecycle.effect.install")).toBe(false);
  });
});
