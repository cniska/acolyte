import { stdout } from "node:process";
import { homedir } from "node:os";

const color = {
  dim: (value: string): string => `\x1b[2m${value}\x1b[22m`,
  // Default brand accent (used only where requested).
  brand: (value: string): string => `\x1b[38;5;183m${value}\x1b[39m`,
  white: (value: string): string => `\x1b[37m${value}\x1b[39m`,
  green: (value: string): string => `\x1b[32m${value}\x1b[39m`,
  yellow: (value: string): string => `\x1b[33m${value}\x1b[39m`,
  red: (value: string): string => `\x1b[31m${value}\x1b[39m`,
  bold: (value: string): string => `\x1b[1m${value}\x1b[22m`,
};

export function banner(model: string, sessionId: string, version: string): void {
  const cwd = process.cwd();
  const home = homedir();
  const shownCwd = cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
  stdout.write(`${color.bold(color.brand("Acolyte"))}${color.dim(` CLI v${version}`)}\n`);
  stdout.write(`${model} ${color.dim("· session")} ${sessionId.slice(0, 12)}\n`);
  stdout.write(`${color.dim(shownCwd)}\n`);
  stdout.write("\n");
}

export async function streamText(content: string): Promise<void> {
  const words = content.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    stdout.write(i === words.length - 1 ? `${words[i]}\n` : `${words[i]} `);
    await Bun.sleep(12);
  }
}

export function printInfo(content: string): void {
  stdout.write(`${color.dim(content)}\n`);
}

export function printSection(title: string): void {
  stdout.write(`${color.bold(color.brand(title))}\n`);
}

export function printToolHeader(title: string, detail?: string): void {
  const base = color.bold(color.white(`• ${title}`));
  const suffix = detail ? ` ${color.dim(detail)}` : "";
  stdout.write(`${base}${suffix}\n`);
}

export function printOutput(content: string): void {
  stdout.write(`${content}\n`);
}

export function printTool(content: string): void {
  stdout.write(`${content}\n`);
}

export function printWarning(content: string): void {
  stdout.write(`${color.yellow(content)}\n`);
}

export function printError(content: string): void {
  stdout.write(`${color.red(content)}\n`);
}

export function clearScreen(): void {
  stdout.write("\x1b[2J\x1b[H");
}
