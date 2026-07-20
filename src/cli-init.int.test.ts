import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { testEnvForHome } from "./int-test-utils";
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
      ...testEnvForHome(home),
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

async function createTestEnv(): Promise<{ home: string; project: string; credentialsPath: string }> {
  const home = dirs.createDir("acolyte-cli-init-home-");
  const project = dirs.createDir("acolyte-cli-init-project-");
  const dir = configDir({ HOME: home });
  await mkdir(dir, { recursive: true });
  return { home, project, credentialsPath: join(dir, "credentials") };
}

describe("cli init", () => {
  test("writes selected provider API key to the global credentials file", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    const result = await runCliWithInput(home, project, ["init", "openai"], "sk-openai-test\n");

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Saved OPENAI_API_KEY");

    const credentials = await readFile(credentialsPath, "utf8");
    expect(credentials).toContain("OPENAI_API_KEY=sk-openai-test");
    // The key belongs to user identity, not the project checkout.
    expect(readFile(join(project, ".env"), "utf8")).rejects.toThrow();
  }, 15_000);

  test("maps vercel to AI_GATEWAY_API_KEY", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    const result = await runCliWithInput(home, project, ["init", "vercel"], "vck-test\n");

    expect(result.exitCode).toBe(0);
    const credentials = await readFile(credentialsPath, "utf8");
    expect(credentials).toContain("AI_GATEWAY_API_KEY=vck-test");
  }, 15_000);

  test("declining the override keeps the existing key", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    await runCliWithInput(home, project, ["init", "openai"], "sk-openai-test\n");

    const second = await runCliWithInput(home, project, ["init", "openai"], "n\n");
    expect(second.exitCode).toBe(0);
    expect(`${second.stdout}\n${second.stderr}`).toContain("Left the existing key unchanged.");

    const credentials = await readFile(credentialsPath, "utf8");
    expect(credentials).toContain("OPENAI_API_KEY=sk-openai-test");
  }, 15_000);

  test("confirming the override replaces the existing key", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    await runCliWithInput(home, project, ["init", "openai"], "sk-openai-test\n");

    const second = await runCliWithInput(home, project, ["init", "openai"], "y\nsk-openai-other\n");
    expect(second.exitCode).toBe(0);

    const credentials = await readFile(credentialsPath, "utf8");
    expect(credentials).toContain("OPENAI_API_KEY=sk-openai-other");
    expect(credentials).not.toContain("OPENAI_API_KEY=sk-openai-test");
  }, 15_000);
});
