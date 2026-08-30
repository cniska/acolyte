import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitEnv, tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();

function createIsolatedEnv(home: string): Record<string, string> {
  const env = { ...process.env };
  delete env.ACOLYTE_SKIP_UPDATE;
  return gitEnv({
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
  });
}

function runCli(
  args: string[],
  env: Record<string, string>,
  cwd: string,
): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "cli.ts"), ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  };
}

function runCliThroughCommandSubstitution(
  args: string[],
  env: Record<string, string>,
  cwd: string,
): { stdout: string; stderr: string; exitCode: number } {
  const quotedArgs = args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
  const cliPath = join(import.meta.dir, "cli.ts").replaceAll("'", "'\\''");
  const script = `out=$(bun run '${cliPath}' ${quotedArgs}); printf '%s' "$out"`;
  const result = Bun.spawnSync(["bash", "--noprofile", "--norc", "-c", script], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  };
}

function expectJsonStdout(output: string): void {
  expect(output.startsWith("{")).toBe(true);
  expect(output).not.toContain("Acolyte v");
  expect(output).not.toContain("\x1b[");
  for (const line of output.trimEnd().split("\n")) JSON.parse(line);
}

describe("cli json output", () => {
  afterEach(() => {
    cleanupDirs();
  });

  test("config list --json writes only JSON to stdout", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const configHome = join(home, ".config", "acolyte");
    mkdirSync(configHome, { recursive: true });
    writeFileSync(join(configHome, "config.json"), JSON.stringify({ locale: "en" }), "utf8");

    const result = runCli(["config", "list", "--json"], createIsolatedEnv(home), workspace);

    expect(result.exitCode).toBe(0);
    expectJsonStdout(result.stdout);
  });

  test("config list --json stays parseable through command substitution", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const configHome = join(home, ".config", "acolyte");
    mkdirSync(configHome, { recursive: true });
    writeFileSync(join(configHome, "config.json"), JSON.stringify({ locale: "en" }), "utf8");

    const result = runCliThroughCommandSubstitution(["config", "list", "--json"], createIsolatedEnv(home), workspace);

    expect(result.exitCode).toBe(0);
    expectJsonStdout(result.stdout);
  });

  test("memory list --json writes only JSON to stdout", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const env = createIsolatedEnv(home);
    const addResult = runCli(["memory", "add", "remember", "json", "output", "--no-update"], env, workspace);
    expect(addResult.exitCode).toBe(0);

    const result = runCli(["memory", "list", "--json"], env, workspace);

    expect(result.exitCode).toBe(0);
    expectJsonStdout(result.stdout);
  });

  test("memory list --json stays parseable through command substitution", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const env = createIsolatedEnv(home);
    const addResult = runCli(["memory", "add", "remember", "json", "output", "--no-update"], env, workspace);
    expect(addResult.exitCode).toBe(0);

    const result = runCliThroughCommandSubstitution(["memory", "list", "--json"], env, workspace);

    expect(result.exitCode).toBe(0);
    expectJsonStdout(result.stdout);
  });

  test("config list --json skips startup update output", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const configHome = join(home, ".config", "acolyte");
    mkdirSync(configHome, { recursive: true });
    writeFileSync(join(configHome, "config.json"), JSON.stringify({ locale: "en" }), "utf8");

    const result = runCli(["config", "list", "--json", "--update"], createIsolatedEnv(home), workspace);

    expect(result.exitCode).toBe(0);
    expectJsonStdout(result.stdout);
  });

  test("memory list --json skips startup update output", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const env = createIsolatedEnv(home);
    const addResult = runCli(["memory", "add", "remember", "json", "output", "--no-update"], env, workspace);
    expect(addResult.exitCode).toBe(0);

    const result = runCli(["memory", "list", "--json", "--update"], env, workspace);

    expect(result.exitCode).toBe(0);
    expectJsonStdout(result.stdout);
  });
});
