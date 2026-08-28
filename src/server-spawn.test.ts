import { describe, expect, test } from "bun:test";
import { isEmbeddedModuleDir, SERVE_COMMAND, serverSpawnCommand } from "./server-spawn";

describe("serverSpawnCommand", () => {
  test("re-runs the binary itself when modules live in the embedded filesystem", () => {
    expect(serverSpawnCommand("/usr/local/bin/acolyte", "/$bunfs/root")).toEqual([
      "/usr/local/bin/acolyte",
      SERVE_COMMAND,
    ]);
  });

  test("hands the CLI entry to the runtime when modules live on disk", () => {
    expect(serverSpawnCommand("/opt/bun/bin/bun", "/repo/src")).toEqual([
      "/opt/bun/bin/bun",
      "run",
      "/repo/src/cli.ts",
      SERVE_COMMAND,
    ]);
  });

  test("recognizes the embedded module directory", () => {
    expect(isEmbeddedModuleDir("/$bunfs/root")).toBe(true);
    expect(isEmbeddedModuleDir("/Users/me/acolyte/src")).toBe(false);
  });
});
