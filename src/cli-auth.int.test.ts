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
  const home = dirs.createDir("acolyte-cli-auth-home-");
  const project = dirs.createDir("acolyte-cli-auth-project-");
  const dir = configDir({ HOME: home });
  await mkdir(dir, { recursive: true });
  return { home, project, credentialsPath: join(dir, "credentials") };
}

describe("cli auth", () => {
  test("writes selected provider API key to the global credentials file", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    const result = await runCliWithInput(home, project, ["auth", "openai", "--key"], "sk-openai-test\n");

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Saved OPENAI_API_KEY");

    const credentials = await readFile(credentialsPath, "utf8");
    expect(credentials).toContain("OPENAI_API_KEY=sk-openai-test");
    expect(readFile(join(project, ".env"), "utf8")).rejects.toThrow();
  }, 15_000);

  test("maps vercel to AI_GATEWAY_API_KEY", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    const result = await runCliWithInput(home, project, ["auth", "vercel", "--key"], "vck-test\n");

    expect(result.exitCode).toBe(0);
    const credentials = await readFile(credentialsPath, "utf8");
    expect(credentials).toContain("AI_GATEWAY_API_KEY=vck-test");
  }, 15_000);

  test("declining the override keeps the existing key", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    await runCliWithInput(home, project, ["auth", "openai", "--key"], "sk-openai-test\n");

    const second = await runCliWithInput(home, project, ["auth", "openai", "--key"], "n\n");
    expect(second.exitCode).toBe(0);
    expect(`${second.stdout}\n${second.stderr}`).toContain("Left the existing key unchanged.");

    const credentials = await readFile(credentialsPath, "utf8");
    expect(credentials).toContain("OPENAI_API_KEY=sk-openai-test");
  }, 15_000);

  test("confirming the override replaces the existing key", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    await runCliWithInput(home, project, ["auth", "openai", "--key"], "sk-openai-test\n");

    const second = await runCliWithInput(home, project, ["auth", "openai", "--key"], "y\nsk-openai-other\n");
    expect(second.exitCode).toBe(0);

    const credentials = await readFile(credentialsPath, "utf8");
    expect(credentials).toContain("OPENAI_API_KEY=sk-openai-other");
    expect(credentials).not.toContain("OPENAI_API_KEY=sk-openai-test");
  }, 15_000);

  test("status lists providers", async () => {
    const { home, project } = await createTestEnv();
    await runCliWithInput(home, project, ["auth", "anthropic", "--key"], "sk-a\n");
    const result = await runCliWithInput(home, project, ["auth"], "");
    expect(result.exitCode).toBe(0);
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toContain("anthropic:");
    expect(out).toContain("api key");
    expect(out).toContain("openai:");
  }, 15_000);

  test("--logout removes stored key", async () => {
    const { home, project, credentialsPath } = await createTestEnv();
    await runCliWithInput(home, project, ["auth", "openai", "--key"], "sk-openai-test\n");
    const result = await runCliWithInput(home, project, ["auth", "openai", "--logout"], "");
    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Removed credentials for openai");
    const credentials = await readFile(credentialsPath, "utf8").catch(() => "");
    expect(credentials).not.toContain("OPENAI_API_KEY");
  }, 15_000);
});
