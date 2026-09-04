import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCliOutcome, testEnvForHome, withCliTestEnv } from "./int-test-utils";

/** A cloud that rejects every request the way an expired token does. */
function serveUnauthorized(): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(JSON.stringify({ error: "Invalid token", code: "E_CLOUD_UNAUTHORIZED" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  });
  return { url: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

describe("cli fatal error boundary", () => {
  test("an unusable cloud store reports a message instead of dumping a stack", async () => {
    const cloud = serveUnauthorized();
    try {
      await withCliTestEnv(async ({ homeDir, configDir }) => {
        await mkdir(configDir, { recursive: true });
        await writeFile(join(configDir, "config.json"), JSON.stringify({ features: { cloudSync: true } }), "utf8");

        const cloudEnv = { ACOLYTE_CLOUD_URL: cloud.url, ACOLYTE_CLOUD_TOKEN: "expired-token" };

        const { code, stderr } = await runCliOutcome(["history"], { env: testEnvForHome(homeDir, cloudEnv) });
        expect(code).not.toBe(0);
        expect(stderr).toContain("acolyte login");
        expect(stderr).not.toContain("Invalid token");
        expect(stderr).not.toContain("at async main");
        expect(stderr).not.toContain("src/cloud-client.ts:");

        const debugRun = await runCliOutcome(["history"], {
          env: testEnvForHome(homeDir, { ...cloudEnv, ACOLYTE_DEBUG: "cli" }),
        });
        expect(debugRun.stderr).toContain("acolyte login");
        expect(debugRun.stderr).toContain("Invalid token");
      });
    } finally {
      cloud.stop();
    }
  });
});
