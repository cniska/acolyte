import { renderToString } from "ink";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import type { SessionStore } from "./types";

export const stripAnsi = (value: string): string => {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "\u001b" && value[i + 1] === "[") {
      i += 2;
      while (i < value.length && value[i] !== "m") i += 1;
      continue;
    }
    if (ch != null) out += ch;
  }
  return out;
};

export const trimRightLines = (value: string): string =>
  value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

export function withTerminalWidth(width: number, run: () => string): string {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", { configurable: true, value: width });
  try {
    return run();
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "columns", descriptor);
  }
}

export function renderInkPlain(node: ReactNode, columns = 96): string {
  const rendered = withTerminalWidth(columns, () => renderToString(node, { columns }));
  return trimRightLines(stripAnsi(rendered)).replace(/^\n+/, "").replace(/\n+$/, "");
}

type RunCliPlainOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export async function runCliPlain(args: string[], options: RunCliPlainOptions = {}): Promise<string> {
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
  const [stdoutText, stderrText] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`cli exited with code ${code}: ${stderrText}`);
  return trimRightLines(stripAnsi(stdoutText)).replace(/^\n+/, "").replace(/\n+$/, "");
}

export type CliTestEnv = {
  homeDir: string;
  workspaceDir: string;
  run: (args: string[], options?: { env?: Record<string, string | undefined> }) => Promise<string>;
  writeSessionsStore: (store: SessionStore) => Promise<void>;
};

export async function withCliTestEnv<T>(fn: (env: CliTestEnv) => Promise<T>): Promise<T> {
  const homeDir = await mkdtemp(join(tmpdir(), "acolyte-cli-home-"));
  const workspaceDir = await mkdtemp(join(tmpdir(), "acolyte-cli-cwd-"));
  const run = (args: string[], options?: { env?: Record<string, string | undefined> }): Promise<string> =>
    runCliPlain(args, {
      cwd: workspaceDir,
      env: {
        HOME: homeDir,
        ...options?.env,
      },
    });
  const writeSessionsStore = async (store: SessionStore): Promise<void> => {
    const dataDir = join(homeDir, ".acolyte");
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "sessions.json"), JSON.stringify(store, null, 2), "utf8");
  };

  try {
    return await fn({ homeDir, workspaceDir, run, writeSessionsStore });
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
