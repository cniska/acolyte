import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "./paths";
import { tempDir } from "./test-utils";

const dirs = tempDir();
const repoRoot = process.cwd();

afterEach(dirs.cleanupDirs);

async function runCliWithInput(
  home: string,
  project: string,
  args: string[],
  input: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", join(repoRoot, "src/cli.ts"), ...args],
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      NO_COLOR: "1",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.stdin) {
    proc.stdin.write(new TextEncoder().encode(input));
    proc.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function createTestEnv(): Promise<{ home: string; project: string }> {
  const home = dirs.createDir("acolyte-cli-init-home-");
  const project = dirs.createDir("acolyte-cli-init-project-");
  await mkdir(configDir({ HOME: home }), { recursive: true });
  return { home, project };
}

describe("cli init", () => {
  test("writes selected provider API key to local .env", async () => {
    const { home, project } = await createTestEnv();
    const result = await runCliWithInput(home, project, ["init", "openai"], "sk-openai-test\n");

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Saved OPENAI_API_KEY");

    const envText = await readFile(join(project, ".env"), "utf8");
    expect(envText).toContain("OPENAI_API_KEY=sk-openai-test");
  }, 15_000);

  test("refuses to re-run when provider key already exists", async () => {
    const { home, project } = await createTestEnv();
    const first = await runCliWithInput(home, project, ["init", "openai"], "sk-openai-test\n");
    expect(first.exitCode).toBe(0);

    const second = await runCliWithInput(home, project, ["init", "openai"], "sk-openai-other\n");
    expect(second.exitCode).toBe(1);
    expect(`${second.stdout}\n${second.stderr}`).toContain("already exists in .env");

    const envText = await readFile(join(project, ".env"), "utf8");
    expect(envText).toContain("OPENAI_API_KEY=sk-openai-test");
    expect(envText).not.toContain("OPENAI_API_KEY=sk-openai-other");
  }, 15_000);
});
