import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDir, dataDir, stateDir } from "./paths";
import type { SessionState } from "./session-contract";
import { stripAnsi } from "./tui/serialize";
import { trimRightLines } from "./tui/test-utils";

type RunCliPlainOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export function testEnvForHome(
  homeDir: string,
  extra?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    HOME: homeDir,
    XDG_CONFIG_HOME: undefined,
    XDG_DATA_HOME: undefined,
    XDG_STATE_HOME: undefined,
    // The preload pins this so the suite ignores a developer's project config, but a spawned
    // process gets its own project directory as cwd and must read the config written there.
    ACOLYTE_PROJECT_DIR: undefined,
    ...extra,
  };
}

export type CliRunOutcome = { code: number; stdout: string; stderr: string };

export async function runCliOutcome(args: readonly string[], options: RunCliPlainOptions = {}): Promise<CliRunOutcome> {
  const env = {
    ...process.env,
    ...options.env,
  };
  const cliPath = join(import.meta.dir, "cli.ts");
  const proc = Bun.spawn({
    cmd: ["bun", "run", cliPath, ...args],
    cwd: options.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return {
    code,
    stdout: trimRightLines(stripAnsi(stdoutText)).replace(/^\n+/, "").replace(/\n+$/, ""),
    stderr: stderrText,
  };
}

export async function runCliPlain(args: readonly string[], options: RunCliPlainOptions = {}): Promise<string> {
  const { code, stdout, stderr } = await runCliOutcome(args, options);
  if (code !== 0) throw new Error(`cli exited with code ${code}: ${stderr}`);
  return stdout;
}

export type CliTestEnv = {
  homeDir: string;
  configDir: string;
  dataDir: string;
  stateDir: string;
  workspaceDir: string;
  run: (args: readonly string[], options?: { env?: Record<string, string | undefined> }) => Promise<string>;
  writeSessionsStore: (sessionState: SessionState) => Promise<void>;
};

export async function withCliTestEnv<T>(fn: (env: CliTestEnv) => Promise<T>): Promise<T> {
  const homeDir = await mkdtemp(join(tmpdir(), "acolyte-cli-home-"));
  const workspaceDir = await mkdtemp(join(tmpdir(), "acolyte-cli-cwd-"));
  const testEnv = { HOME: homeDir };
  const testConfigDir = configDir(testEnv);
  const testDataDir = dataDir(testEnv);
  const testStateDir = stateDir(testEnv);
  const run = (args: readonly string[], options?: { env?: Record<string, string | undefined> }): Promise<string> =>
    runCliPlain(args, {
      cwd: workspaceDir,
      env: testEnvForHome(homeDir, options?.env),
    });
  const writeSessionsStore = async (record: SessionState): Promise<void> => {
    await mkdir(testDataDir, { recursive: true });
    await writeFile(join(testDataDir, "sessions.json"), JSON.stringify(record, null, 2), "utf8");
  };

  try {
    return await fn({
      homeDir,
      configDir: testConfigDir,
      dataDir: testDataDir,
      stateDir: testStateDir,
      workspaceDir,
      run,
      writeSessionsStore,
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  }
}
