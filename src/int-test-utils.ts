import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDir, dataDir, stateDir } from "./paths";
import type { SessionState } from "./session-contract";
import { stripAnsi } from "./tui/serialize";
import { trimRightLines } from "./tui-test-utils";

type RunCliPlainOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export async function runCliPlain(args: readonly string[], options: RunCliPlainOptions = {}): Promise<string> {
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
  if (code !== 0) throw new Error(`cli exited with code ${code}: ${stderrText}`);
  return trimRightLines(stripAnsi(stdoutText)).replace(/^\n+/, "").replace(/\n+$/, "");
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
      env: {
        HOME: homeDir,
        ...options?.env,
      },
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

type TestHttpHandler = (request: Request) => Response | Promise<Response>;

export async function withTestHttpServer<T>(handler: TestHttpHandler, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = Bun.serve({
    port: 0,
    fetch: handler,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    return await fn(baseUrl);
  } finally {
    server.stop(true);
  }
}
