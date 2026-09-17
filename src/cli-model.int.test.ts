import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { daemonsDir } from "./daemon-ops";
import { runCliOutcome, testEnvForHome, withCliTestEnv } from "./int-test-utils";

describe("a fresh install has no model", () => {
  test("run reports that no model is configured and starts no daemon", async () => {
    await withCliTestEnv(async ({ homeDir, workspaceDir }) => {
      const { code, stderr } = await runCliOutcome(["run", "hello"], {
        cwd: workspaceDir,
        env: testEnvForHome(homeDir),
      });
      expect(code).toBe(1);
      expect(stderr).toContain("No model configured. Run acolyte config set model <id> to choose one.");
      expect(existsSync(daemonsDir({ HOME: homeDir }))).toBe(false);
    });
  }, 20_000);

  test("config list shows no model until one is set", async () => {
    await withCliTestEnv(async ({ run }) => {
      expect(await run(["config", "list"])).not.toContain("model:");
      await run(["config", "set", "model", "gpt-5-mini"]);
      expect(await run(["config", "list"])).toContain("model:  gpt-5-mini");
    });
  }, 20_000);
});
