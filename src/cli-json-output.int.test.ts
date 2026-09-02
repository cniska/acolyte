import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSqliteMemoryStore } from "./memory-store";
import { dataDir } from "./paths";
import { LOCAL_USER_RESOURCE_ID } from "./resource-id";
import { gitEnv, startTestServer, tempDir } from "./test-utils";
import { createTraceStore } from "./trace-store";

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

/** The distiller is the only writer, so a listing test seeds the store the way it does. */
async function seedMemory(home: string): Promise<void> {
  const dir = dataDir({ HOME: home });
  mkdirSync(dir, { recursive: true });
  const store = createSqliteMemoryStore(join(dir, "memory.db"));
  await store.write(
    {
      id: "mem_jsonseed",
      scopeKey: LOCAL_USER_RESOURCE_ID,
      content: "json output stays parseable",
      createdAt: "2026-09-01T00:00:00.000Z",
      tokenEstimate: 5,
    },
    "user",
  );
  store.close();
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
  const script = `out=$(bun run '${cliPath}' ${quotedArgs}); code=$?; printf '%s' "$out"; exit $code`;
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

  test("memory list --json writes only JSON to stdout", async () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const env = createIsolatedEnv(home);
    await seedMemory(home);

    const result = runCli(["memory", "list", "--json"], env, workspace);

    expect(result.exitCode).toBe(0);
    expectJsonStdout(result.stdout);
  });

  test("memory list --json stays parseable through command substitution", async () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const env = createIsolatedEnv(home);
    await seedMemory(home);

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

  test("memory list --json skips startup update output", async () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    const env = createIsolatedEnv(home);
    await seedMemory(home);

    const result = runCli(["memory", "list", "--json", "--update"], env, workspace);

    expect(result.exitCode).toBe(0);
    expectJsonStdout(result.stdout);
  });

  function seedTraceStore(home: string, seed: (store: ReturnType<typeof createTraceStore>) => void): void {
    const dir = dataDir({ HOME: home });
    mkdirSync(dir, { recursive: true });
    const store = createTraceStore(join(dir, "trace.db"));
    seed(store);
    store.close();
  }

  test("trace task --json writes nothing when the store holds no such task", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    seedTraceStore(home, (store) =>
      store.write({
        timestamp: "2026-01-01T00:00:00.000Z",
        taskId: "task_present",
        event: "lifecycle.start",
        fields: { model: "gpt-5" },
      }),
    );

    const result = runCli(["trace", "task", "task_missing", "--json"], createIsolatedEnv(home), workspace);

    expect(result.stdout).toBe("");
  });

  test("trace --json writes nothing when the store holds no tasks", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    seedTraceStore(home, () => {});

    const result = runCli(["trace", "--json"], createIsolatedEnv(home), workspace);

    expect(result.stdout).toBe("");
  });

  test("trace task --json filtered to nothing writes nothing", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");
    seedTraceStore(home, (store) =>
      store.write({
        timestamp: "2026-01-01T00:00:00.000Z",
        taskId: "task_present",
        event: "lifecycle.tool.call",
        fields: { tool: "file-read" },
      }),
    );

    const result = runCli(
      ["trace", "task", "task_present", "--tool", "web-fetch", "--json"],
      createIsolatedEnv(home),
      workspace,
    );

    expect(result.stdout).toBe("");
  });

  test("history --json writes nothing when there are no sessions", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");

    const result = runCli(["history", "--json"], createIsolatedEnv(home), workspace);

    expect(result.stdout).toBe("");
  });

  test("piped help carries no escape codes", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");

    const result = runCli(["--help"], createIsolatedEnv(home), workspace);

    expect(result.stdout).toContain("Usage");
    expect(result.stdout).not.toContain(String.fromCharCode(27));
  });

  test("a diagnostic goes to stderr and leaves stdout empty", () => {
    const home = createDir("acolyte-cli-json-home-");
    const workspace = createDir("acolyte-cli-json-workspace-");

    const result = runCli(["trace", "task", "task_missing"], createIsolatedEnv(home), workspace);

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("No trace data available");
  });

  test("status --json reports a stopped daemon as parseable JSON", () => {
    const home = createDir("acolyte-cli-json-home-");
    const env = createIsolatedEnv(home);
    const workspace = createDir("acolyte-cli-json-workspace-");
    const init = Bun.spawnSync(["git", "init"], { cwd: workspace, env, stdout: "pipe", stderr: "pipe" });
    expect(init.exitCode).toBe(0);
    env.ACOLYTE_PROJECT_DIR = workspace;
    const reserved = startTestServer(() => new Response("reserved"));
    const port = reserved.port;
    reserved.stop();
    mkdirSync(join(workspace, ".acolyte"), { recursive: true });
    writeFileSync(join(workspace, ".acolyte", "config.toml"), `port = ${port}\n`, "utf8");

    const result = runCliThroughCommandSubstitution(["status", "--json"], env, workspace);

    expect(result.exitCode).toBe(1);
    expectJsonStdout(result.stdout);
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, state: "stopped", port });
  });
});
