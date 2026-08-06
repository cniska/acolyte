import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMcpTransport } from "./mcp-transport";
import { tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

const REPORTER = `const { writeFileSync } = require("node:fs");
writeFileSync(process.argv[2], JSON.stringify({
  cwd: process.cwd(),
  pluginRoot: process.env.PLUGIN_ROOT ?? null,
  pluginData: process.env.PLUGIN_DATA ?? null,
  extra: process.env.EXTRA ?? null,
  home: process.env.HOME ?? null,
}));
setTimeout(() => process.exit(0), 5_000);
`;

async function waitForFile(path: string): Promise<Record<string, string | null>> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`subprocess never wrote ${path}`);
}

describe("stdio transport launch", () => {
  test("launches the command in the configured directory with the configured environment", async () => {
    const workspace = dirs.createDir("acolyte-mcp-launch-");
    const script = join(workspace, "report.js");
    const report = join(workspace, "report.json");
    writeFileSync(script, REPORTER, "utf8");

    const transport = createMcpTransport({
      type: "stdio",
      command: process.execPath,
      args: [script, report],
      env: { PLUGIN_ROOT: workspace, PLUGIN_DATA: join(workspace, "data"), EXTRA: "value" },
      cwd: workspace,
    });

    try {
      await transport.start();
      const observed = await waitForFile(report);
      expect(observed.pluginRoot).toBe(workspace);
      expect(observed.pluginData).toBe(join(workspace, "data"));
      expect(observed.extra).toBe("value");
      // The allowlist still supplies the base environment the config did not name.
      expect(observed.home).toBe(process.env.HOME ?? null);
      expect(observed.cwd).toBe(realpathSync(workspace));
    } finally {
      await transport.close();
    }
  });

  test("defaults to the process working directory when no cwd is configured", async () => {
    const workspace = dirs.createDir("acolyte-mcp-nocwd-");
    const script = join(workspace, "report.js");
    const report = join(workspace, "report.json");
    writeFileSync(script, REPORTER, "utf8");

    const transport = createMcpTransport({ type: "stdio", command: process.execPath, args: [script, report] });

    try {
      await transport.start();
      const observed = await waitForFile(report);
      expect(observed.cwd).toBe(process.cwd());
    } finally {
      await transport.close();
    }
  });
});
