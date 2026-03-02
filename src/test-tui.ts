import { renderToString } from "ink";
import type { ReactNode } from "react";

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

export async function runCliPlain(args: string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/cli.ts", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdoutText, stderrText] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`cli exited with code ${code}: ${stderrText}`);
  return trimRightLines(stripAnsi(stdoutText)).replace(/^\n+/, "").replace(/\n+$/, "");
}
